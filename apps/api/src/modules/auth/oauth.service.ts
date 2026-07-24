import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  InstanceService,
  type OAuthConfig,
  type OAuthProvider,
} from '../instance/instance.service';

/**
 * Hand-rolled authorization-code flow (ADR 0008 §2). No Passport OAuth
 * strategies: they capture clientID/clientSecret at construction time, while
 * ours are runtime-mutable instance config. The whole flow is two `fetch`
 * calls per provider against this frozen table.
 */
const PROVIDERS: Record<
  OAuthProvider,
  { authorizeUrl: string; tokenUrl: string; scope: string }
> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
  },
};

const FETCH_TIMEOUT_MS = 10_000;

/** Frozen failure codes (ADR 0008 §4) — the only detail a redirect URL carries. */
export type OAuthFailureCode =
  | 'oauth_failed'
  | 'signup_disabled'
  | 'account_disabled';

export class OAuthFlowError extends Error {
  constructor(readonly code: OAuthFailureCode) {
    super(code);
    this.name = 'OAuthFlowError';
  }
}

/** Normalized provider profile. `email` is present only when VERIFIED. */
interface OAuthProfile {
  id: string;
  email: string | null;
  name: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private instance: InstanceService,
    private cfg: ConfigService,
  ) {}

  /**
   * 404 unless the provider exists AND is effectively enabled (toggle on +
   * credentials present) — resolved per request, so disabling a provider
   * kills in-flight flows too (ADR 0008 §3).
   */
  async requireEnabled(
    provider: string,
  ): Promise<{ provider: OAuthProvider; config: OAuthConfig }> {
    if (provider !== 'google' && provider !== 'github') {
      throw new NotFoundException();
    }
    const config = await this.instance.getOAuthConfig(provider);
    if (!config.enabled) throw new NotFoundException();
    return { provider, config };
  }

  buildAuthorizeUrl(
    provider: OAuthProvider,
    clientId: string,
    state: string,
  ): string {
    const def = PROVIDERS[provider];
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: def.scope,
      state,
    });
    return `${def.authorizeUrl}?${params.toString()}`;
  }

  /** Exchange the code, fetch the profile, resolve to a User (ADR 0008 §5). */
  async exchangeAndResolve(
    provider: OAuthProvider,
    config: OAuthConfig,
    code: string,
  ): Promise<UserDocument> {
    const accessToken = await this.exchangeCode(provider, config, code);
    const profile =
      provider === 'google'
        ? await this.fetchGoogleProfile(accessToken)
        : await this.fetchGithubProfile(accessToken);
    return this.resolveUser(provider, profile);
  }

  // ── Provider HTTP ─────────────────────────────────────────────────
  private async exchangeCode(
    provider: OAuthProvider,
    config: OAuthConfig,
    code: string,
  ): Promise<string> {
    const res = await this.safeFetch(PROVIDERS[provider].tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: this.redirectUri(provider),
      }).toString(),
    });
    const data = (await this.safeJson(res)) as {
      access_token?: string;
      error?: string;
    };
    if (!res.ok || !data.access_token) {
      // Never surface provider error details to the client (coarse codes only).
      this.logger.warn(
        `${provider} token exchange failed: ${res.status} ${data.error ?? ''}`,
      );
      throw new OAuthFlowError('oauth_failed');
    }
    return data.access_token;
  }

  private async fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
    const res = await this.safeFetch(
      'https://openidconnect.googleapis.com/v1/userinfo',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const info = (await this.safeJson(res)) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!res.ok || !info.sub) throw new OAuthFlowError('oauth_failed');
    // Email-match linking on an unverified email is an account-takeover
    // vector: only email_verified === true counts (ADR 0008 §5).
    const email =
      info.email_verified === true && info.email
        ? info.email.toLowerCase().trim()
        : null;
    return {
      id: info.sub,
      email,
      name: info.name?.trim() || email?.split('@')[0] || 'Google user',
    };
  }

  private async fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'prism-api',
    };
    const res = await this.safeFetch('https://api.github.com/user', { headers });
    const user = (await this.safeJson(res)) as {
      id?: number;
      login?: string;
      name?: string | null;
    };
    if (!res.ok || user.id == null) throw new OAuthFlowError('oauth_failed');

    // The profile `email` field is whatever the user made public — only the
    // primary+verified entry from /user/emails proves ownership (ADR 0008 §5).
    const emailsRes = await this.safeFetch(
      'https://api.github.com/user/emails',
      { headers },
    );
    const emails = (await this.safeJson(emailsRes)) as Array<{
      email?: string;
      primary?: boolean;
      verified?: boolean;
    }>;
    const primary = Array.isArray(emails)
      ? emails.find((e) => e.primary === true && e.verified === true)
      : undefined;
    const email = primary?.email ? primary.email.toLowerCase().trim() : null;

    return {
      id: String(user.id),
      email,
      name: user.name?.trim() || user.login || 'GitHub user',
    };
  }

  // ── User resolution (ADR 0008 §5, order is LOCKED) ────────────────
  private async resolveUser(
    provider: OAuthProvider,
    profile: OAuthProfile,
  ): Promise<UserDocument> {
    const idField = provider === 'google' ? 'googleId' : 'githubId';

    // 1. By provider id → login.
    let user = await this.userModel.findOne({ [idField]: profile.id });
    if (user) {
      if (user.blocked) throw new OAuthFlowError('account_disabled');
      return user;
    }

    // No verified email → no linking, no signup.
    if (!profile.email) throw new OAuthFlowError('oauth_failed');

    // 2. By verified email → link → login. The provider proved email
    // ownership at least as strongly as the invite token would, so a
    // pending invite is considered accepted.
    user = await this.userModel.findOne({ email: profile.email });
    if (user) {
      if (user.blocked) throw new OAuthFlowError('account_disabled');
      user.set(idField, profile.id);
      if (user.invitePending) {
        user.invitePending = false;
        user.inviteToken = null;
        user.inviteTokenExpiry = null;
      }
      await user.save();
      return user;
    }

    // 3. New user — only when effective signup is on.
    if (!(await this.instance.isSignupEnabled())) {
      throw new OAuthFlowError('signup_disabled');
    }
    // Random password: password login stays effectively disabled until the
    // user sets one (and without one they can never pass step-up).
    const passwordHash = await bcrypt.hash(
      crypto.randomBytes(48).toString('hex'),
      12,
    );
    return this.userModel.create({
      email: profile.email,
      name: profile.name,
      role: 'dev',
      passwordHash,
      [idField]: profile.id,
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────
  private redirectUri(provider: OAuthProvider): string {
    const base = (
      this.cfg.get<string>('API_URL') ?? 'http://localhost:4000'
    ).replace(/\/+$/, '');
    return `${base}/api/v1/auth/oauth/${provider}/callback`;
  }

  private async safeFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`OAuth request to ${url} failed: ${String(err)}`);
      throw new OAuthFlowError('oauth_failed');
    }
  }

  private async safeJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      return {};
    }
  }
}
