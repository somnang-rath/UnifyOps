import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { Instance, InstanceDocument } from './schemas/instance.schema';
import {
  InstanceConfiguration,
  InstanceConfigurationDocument,
} from './schemas/instance-configuration.schema';
import {
  InstanceAdmin,
  InstanceAdminDocument,
} from './schemas/instance-admin.schema';
import {
  AddAdminDto,
  isSecretConfigKey,
  PUBLIC_CONFIG_KEYS,
  TestEmailDto,
  UpdateConfigDto,
  UpdateInstanceDto,
} from './dto/instance.dto';
import { UsersService } from '../users/users.service';

const oid = (v: string) => new Types.ObjectId(v);

export type AssistantProvider = 'anthropic' | 'openai';

/**
 * Resolved AI configuration for the assistant, read from instance config.
 * `anthropic.apiKey` / `openai.apiKey` are secrets — this object must stay
 * server-side and must never be returned from a controller.
 */
export interface AiConfig {
  enabled: boolean;
  provider: AssistantProvider;
  systemPrompt: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  allowTools: boolean;
  rateLimitPerMin: number;
  anthropic: { apiKey: string; model: string };
  openai: { apiKey: string; model: string };
}

export type OAuthProvider = 'google' | 'github';

/**
 * Resolved OAuth credentials for one provider (ADR 0008 §1). `clientSecret`
 * is a secret — this object must stay server-side and must never be returned
 * from a controller (same rule as `getAiConfig`).
 */
export interface OAuthConfig {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

/**
 * Resolved Unsplash proxy configuration (ADR 0010 §1). `accessKey` is a
 * secret — this object must stay server-side and must never be returned
 * from a controller (same rule as `getAiConfig` / `getOAuthConfig`).
 */
export interface UnsplashConfig {
  enabled: boolean;
  accessKey: string;
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  /** Set → webhook mode; empty → long polling. */
  webhookUrl: string;
  /** Verifies inbound webhook requests via X-Telegram-Bot-Api-Secret-Token. */
  webhookSecret: string;
}

@Injectable()
export class InstanceService {
  constructor(
    @InjectModel(Instance.name)
    private instanceModel: Model<InstanceDocument>,
    @InjectModel(InstanceConfiguration.name)
    private configModel: Model<InstanceConfigurationDocument>,
    @InjectModel(InstanceAdmin.name)
    private adminModel: Model<InstanceAdminDocument>,
    private users: UsersService,
    private cfg: ConfigService,
  ) {}

  // ── Instance singleton ────────────────────────────────────────────
  private async ensureInstance(): Promise<InstanceDocument> {
    const existing = await this.instanceModel.findOne();
    if (existing) return existing;
    return this.instanceModel.create({
      instanceId: randomUUID(),
      instanceName: 'Prism',
    });
  }

  /** Full instance info — admin only. */
  async getInstance() {
    return this.ensureInstance();
  }

  async updateInstance(dto: UpdateInstanceDto) {
    const inst = await this.ensureInstance();
    if (dto.instanceName !== undefined) inst.instanceName = dto.instanceName;
    await inst.save();
    return inst;
  }

  /**
   * Public bootstrap payload for web/admin/space — identity + whitelisted
   * public config (auth toggles) + whether setup is done. No secrets.
   */
  async getPublicInstance() {
    const inst = await this.ensureInstance();
    const adminExists = (await this.adminModel.estimatedDocumentCount()) > 0;
    const publicCfg = await this.configModel
      .find({ key: { $in: [...PUBLIC_CONFIG_KEYS] } })
      .lean();
    const config: Record<string, boolean> = {};
    for (const key of PUBLIC_CONFIG_KEYS) {
      const row = publicCfg.find((c) => c.key === key);
      config[key] = row?.value === 'true';
    }
    // OAuth toggles report the EFFECTIVE value (toggle AND credentials present,
    // ADR 0008 §1): clients never learn *why* a provider is off, just the
    // boolean — and the frontends render the login buttons from this alone.
    const [google, github, unsplash] = await Promise.all([
      this.getOAuthConfig('google'),
      this.getOAuthConfig('github'),
      this.getUnsplashConfig(),
    ]);
    config.GOOGLE_OAUTH_ENABLED = google.enabled;
    config.GITHUB_OAUTH_ENABLED = github.enabled;
    // Same effective-boolean rule for Unsplash (ADR 0010 §1): toggle AND access
    // key present. Clients see only the boolean, never the key.
    config.UNSPLASH_ENABLED = unsplash.enabled;
    return {
      instanceId: inst.instanceId,
      instanceName: inst.instanceName,
      currentVersion: inst.currentVersion,
      isSetupDone: inst.isSetupDone,
      adminExists,
      config,
    };
  }

  // ── Configuration (key/value) ─────────────────────────────────────
  /**
   * All config entries — admin only. Secret values are never returned, only
   * whether they are set. Secrecy is recomputed from the key on every read, so
   * a row stored before SECRET_CONFIG_KEYS grew cannot leak.
   */
  async getConfig() {
    const rows = await this.configModel.find().sort({ category: 1, key: 1 }).lean();
    return rows.map((r) => {
      const secret = isSecretConfigKey(r.key) || r.isEncrypted;
      return {
        key: r.key,
        category: r.category,
        isEncrypted: secret,
        value: secret ? null : r.value,
        isSet: r.value != null && r.value !== '',
      };
    });
  }

  async updateConfig(dto: UpdateConfigDto) {
    await Promise.all(
      dto.entries.map((e) => {
        const set: Record<string, unknown> = {
          category: e.category,
          isEncrypted: isSecretConfigKey(e.key),
        };
        // An empty value on a secret means "leave it alone": the admin UI shows
        // masked fields as blank, so saving a form must not wipe the stored key.
        const blankSecret = isSecretConfigKey(e.key) && !e.value;
        if (!blankSecret) set.value = e.value;

        return this.configModel.updateOne(
          { key: e.key },
          { $set: set },
          { upsert: true },
        );
      }),
    );
    return this.getConfig();
  }

  /** Read a single config value (used internally, e.g. for email test). */
  private async getConfigValue(key: string): Promise<string | null> {
    const row = await this.configModel.findOne({ key }).lean();
    return row?.value ?? null;
  }

  /**
   * Read a single non-secret config value. For server-side consumers (e.g. the
   * Telegram transport's poll offset). Do not use for secret keys — callers that
   * need a token use the purpose-built resolvers above.
   */
  async readConfigValue(key: string): Promise<string | null> {
    return this.getConfigValue(key);
  }

  /**
   * Resolve the full AI configuration (including secret provider keys) for the
   * assistant. Server-side only — never expose the return value to clients.
   */
  async getAiConfig(): Promise<AiConfig> {
    const keys = [
      'ASSISTANT_ENABLED',
      'ASSISTANT_PROVIDER',
      'ASSISTANT_SYSTEM_PROMPT',
      'ASSISTANT_EFFORT',
      'ASSISTANT_MAX_TOKENS',
      'ASSISTANT_ALLOW_TOOLS',
      'ASSISTANT_RATE_LIMIT_PER_MIN',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_MODEL',
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
    ];
    const rows = await this.configModel
      .find({ key: { $in: keys } })
      .lean();
    const map = new Map(rows.map((r) => [r.key, r.value ?? '']));
    const str = (k: string) => (map.get(k) ?? '').trim();
    const bool = (k: string) => str(k) === 'true';
    const num = (k: string, fallback: number) => {
      const n = Number(str(k));
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    const provider: AssistantProvider =
      str('ASSISTANT_PROVIDER') === 'openai' ? 'openai' : 'anthropic';
    const effortRaw = str('ASSISTANT_EFFORT');
    const effort = (
      ['low', 'medium', 'high', 'xhigh', 'max'].includes(effortRaw)
        ? effortRaw
        : 'high'
    ) as AiConfig['effort'];

    return {
      enabled: bool('ASSISTANT_ENABLED'),
      provider,
      systemPrompt: str('ASSISTANT_SYSTEM_PROMPT'),
      effort,
      maxTokens: num('ASSISTANT_MAX_TOKENS', 8000),
      allowTools: bool('ASSISTANT_ALLOW_TOOLS'),
      rateLimitPerMin: num('ASSISTANT_RATE_LIMIT_PER_MIN', 20),
      anthropic: {
        apiKey: str('ANTHROPIC_API_KEY'),
        model: str('ANTHROPIC_MODEL') || 'claude-opus-4-8',
      },
      openai: {
        apiKey: str('OPENAI_API_KEY'),
        model: str('OPENAI_MODEL') || 'gpt-4o-mini',
      },
    };
  }

  /**
   * Resolve the Telegram bridge configuration (including the secret bot token) for
   * the chat module. Server-side only — never expose the token to any client.
   */
  async getTelegramConfig(): Promise<TelegramConfig> {
    const keys = [
      'TELEGRAM_ENABLED',
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_WEBHOOK_URL',
      'TELEGRAM_WEBHOOK_SECRET',
    ];
    const rows = await this.configModel.find({ key: { $in: keys } }).lean();
    const map = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));
    return {
      enabled: map.get('TELEGRAM_ENABLED') === 'true',
      botToken: map.get('TELEGRAM_BOT_TOKEN') ?? '',
      webhookUrl: map.get('TELEGRAM_WEBHOOK_URL') ?? '',
      webhookSecret: map.get('TELEGRAM_WEBHOOK_SECRET') ?? '',
    };
  }

  /**
   * Resolve one OAuth provider's credentials (ADR 0008 §1), config-over-env:
   *
   *   clientId     = instanceConfig[<P>_CLIENT_ID]     || env.<P>_CLIENT_ID     || ''
   *   clientSecret = instanceConfig[<P>_CLIENT_SECRET] || env.<P>_CLIENT_SECRET || ''
   *   enabled      = instanceConfig[<P>_OAUTH_ENABLED] === 'true' && both non-empty
   *
   * Resolved at request time, never cached at boot — an admin toggling a
   * provider off kills new logins immediately. Server-side only: the secret
   * must never reach a controller response.
   */
  async getOAuthConfig(provider: OAuthProvider): Promise<OAuthConfig> {
    const P = provider.toUpperCase();
    const keys = [`${P}_OAUTH_ENABLED`, `${P}_CLIENT_ID`, `${P}_CLIENT_SECRET`];
    const rows = await this.configModel.find({ key: { $in: keys } }).lean();
    const map = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));

    const clientId =
      map.get(`${P}_CLIENT_ID`) ||
      (this.cfg.get<string>(`${P}_CLIENT_ID`) ?? '').trim();
    const clientSecret =
      map.get(`${P}_CLIENT_SECRET`) ||
      (this.cfg.get<string>(`${P}_CLIENT_SECRET`) ?? '').trim();
    const enabled =
      map.get(`${P}_OAUTH_ENABLED`) === 'true' &&
      clientId !== '' &&
      clientSecret !== '';

    return { enabled, clientId, clientSecret };
  }

  /**
   * Resolve the Unsplash proxy configuration (ADR 0010 §1), config-over-env:
   *
   *   accessKey = instanceConfig[UNSPLASH_ACCESS_KEY] || env.UNSPLASH_ACCESS_KEY || ''
   *   enabled   = instanceConfig[UNSPLASH_ENABLED] === 'true' && accessKey !== ''
   *
   * Resolved at request time, never cached at boot — an admin toggling it off
   * takes effect immediately. Server-side only: the access key must never
   * reach a controller response.
   */
  async getUnsplashConfig(): Promise<UnsplashConfig> {
    const keys = ['UNSPLASH_ENABLED', 'UNSPLASH_ACCESS_KEY'];
    const rows = await this.configModel.find({ key: { $in: keys } }).lean();
    const map = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));

    const accessKey =
      map.get('UNSPLASH_ACCESS_KEY') ||
      (this.cfg.get<string>('UNSPLASH_ACCESS_KEY') ?? '').trim();
    const enabled = map.get('UNSPLASH_ENABLED') === 'true' && accessKey !== '';

    return { enabled, accessKey };
  }

  /**
   * Effective signup switch (ADR 0008 §5): the instance config row wins when
   * set, else the env `ALLOW_PUBLIC_REGISTER` — config-over-env, consistent
   * with getOAuthConfig.
   */
  async isSignupEnabled(): Promise<boolean> {
    const row = await this.getConfigValue('ENABLE_SIGNUP');
    if (row != null && row !== '') return row === 'true';
    return Boolean(this.cfg.get<boolean>('ALLOW_PUBLIC_REGISTER'));
  }

  /**
   * Persist a single config value. Used by the chat module for runtime state that
   * must survive a restart — e.g. the long-poll `getUpdates` offset and a
   * generated webhook secret. Respects key-based secrecy like updateConfig.
   */
  async setConfigValue(
    key: string,
    value: string,
    category = 'integrations',
  ): Promise<void> {
    await this.configModel.updateOne(
      { key },
      { $set: { value, category, isEncrypted: isSecretConfigKey(key) } },
      { upsert: true },
    );
  }

  // ── Instance admins ───────────────────────────────────────────────
  async listAdmins() {
    const rows = await this.adminModel
      .find()
      .populate('userId', 'name email avatar role')
      .sort({ createdAt: 1 })
      .lean();
    return rows.map((r) => ({
      id: String(r._id),
      role: r.role,
      user: r.userId, // populated { _id, name, email, avatar, role } or null
    }));
  }

  async addAdmin(dto: AddAdminDto) {
    let userId = dto.userId;
    if (!userId && dto.email) {
      const user = await this.users.findByEmail(dto.email.toLowerCase().trim());
      if (!user) throw new NotFoundException('No user with that email');
      userId = user._id.toString();
    }
    if (!userId) throw new BadRequestException('Provide email or userId');

    const exists = await this.adminModel.exists({ userId: oid(userId) });
    if (exists) throw new ConflictException('User is already an instance admin');

    await this.adminModel.create({ userId: oid(userId) });
    return this.listAdmins();
  }

  async removeAdmin(userId: string) {
    const count = await this.adminModel.estimatedDocumentCount();
    if (count <= 1) {
      throw new BadRequestException('Cannot remove the last instance admin');
    }
    const res = await this.adminModel.deleteOne({ userId: oid(userId) });
    if (res.deletedCount === 0) throw new NotFoundException('Admin not found');
    return this.listAdmins();
  }

  async isInstanceAdmin(userId: string): Promise<boolean> {
    return Boolean(await this.adminModel.exists({ userId: oid(userId) }));
  }

  // ── First-run setup ───────────────────────────────────────────────
  async getSetupStatus() {
    const inst = await this.ensureInstance();
    const adminExists = (await this.adminModel.estimatedDocumentCount()) > 0;
    return { isSetupDone: inst.isSetupDone, adminExists };
  }

  /**
   * Claim the instance: the calling (authenticated) user becomes the first
   * instance admin. Only allowed while no instance admin exists.
   */
  async setupFirstAdmin(userId: string) {
    const adminExists = (await this.adminModel.estimatedDocumentCount()) > 0;
    if (adminExists) {
      throw new ConflictException('Instance already has an admin');
    }
    await this.adminModel.create({ userId: oid(userId) });
    const inst = await this.ensureInstance();
    inst.isSetupDone = true;
    await inst.save();
    return this.getSetupStatus();
  }

  // ── Email (SMTP) test ─────────────────────────────────────────────
  /**
   * Validates SMTP config is present. Actual delivery via nodemailer is a
   * Phase 4 follow-up; for now this confirms the config exists so the admin
   * UI can surface a clear result.
   */
  async testEmail(_dto: TestEmailDto) {
    const host = await this.getConfigValue('SMTP_HOST');
    if (!host) {
      throw new BadRequestException('SMTP_HOST is not configured');
    }
    return { ok: true, message: 'SMTP configuration present' };
  }
}
