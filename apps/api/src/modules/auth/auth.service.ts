import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  InstanceAdmin,
  InstanceAdminDocument,
} from '../instance/schemas/instance-admin.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { AcceptInviteDto, LoginDto, RegisterDto } from './dto/auth.dto';
import {
  AUD_ADMIN,
  AUD_COLLAB,
  AUD_WEB,
  type RestAudience,
} from '../../common/auth/audience';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A rotated token stays usable for this long. Without it, two tabs refreshing at
 * the same moment would race: the loser presents an already-rotated token and
 * gets signed out. Inside the window a reuse is treated as that race, not theft.
 * See docs/plan/01-security-model.md §3.1.
 */
const ROTATION_GRACE_MS = 60 * 1000;

/** Collab tokens are scoped to one document and must be short — apps/live re-checks. */
const COLLAB_TTL_SEC = 5 * 60;

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private rtModel: Model<RefreshTokenDocument>,
    @InjectModel(InstanceAdmin.name)
    private adminModel: Model<InstanceAdminDocument>,
    private users: UsersService,
    private jwt: JwtService,
    private cfg: ConfigService,
  ) {}

  async register(dto: RegisterDto, meta: SessionMeta = {}) {
    const exists = await this.userModel.exists({ email: dto.email });
    if (exists) throw new ConflictException('Email already in use');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userModel.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });
    return this.issueTokens(user, AUD_WEB, meta);
  }

  /**
   * Password login. `audience` decides which app the session is for; asking for
   * `admin` requires the user to actually be an instance admin, so a stolen web
   * token can never be traded up into God Mode (docs/plan/01 §1 S4).
   */
  async login(
    dto: LoginDto,
    audience: RestAudience = AUD_WEB,
    meta: SessionMeta = {},
  ) {
    const user = await this.userModel
      .findOne({ email: dto.email })
      .select('+passwordHash');
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.invitePending)
      throw new UnauthorizedException(
        'Please accept your invitation email before signing in.',
      );
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    if (user.blocked)
      throw new ForbiddenException('Your account has been disabled');

    if (audience === AUD_ADMIN) {
      const isAdmin = await this.adminModel.exists({ userId: user._id });
      if (!isAdmin) throw new ForbiddenException('Instance admin access required');
    }

    // A password login is itself a step-up: the user just proved possession.
    return this.issueTokens(user, audience, meta, { stepUp: true });
  }

  /**
   * Session for a user the OAuth callback just authenticated (ADR 0008 §4).
   * Web audience only, and never a step-up: only a password proves possession,
   * so an OAuth login can never unlock instance mutations.
   */
  async issueOAuthSession(user: UserDocument, meta: SessionMeta = {}) {
    return this.issueTokens(user, AUD_WEB, meta, { stepUp: false });
  }

  /** Re-prove the password without starting a new session (instance mutations). */
  async stepUp(userId: string, password: string, audience: RestAudience) {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user) throw new UnauthorizedException();
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid password');
    const accessToken = await this.signAccess(user, audience, true);
    return { accessToken };
  }

  async acceptInvite(dto: AcceptInviteDto, meta: SessionMeta = {}) {
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.token)
      .digest('hex');

    const user = await this.userModel
      .findOne({
        inviteToken: tokenHash,
        inviteTokenExpiry: { $gt: new Date() },
        invitePending: true,
      })
      .select('+passwordHash');

    if (!user)
      throw new BadRequestException(
        'Invalid or expired invite link. Ask your admin to resend the invitation.',
      );

    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.invitePending = false;
    user.inviteToken = null;
    user.inviteTokenExpiry = null;
    await user.save();

    return this.issueTokens(user, AUD_WEB, meta);
  }

  /**
   * Rotate a refresh token. The presented token is spent and a fresh one issued
   * in the same family. Presenting a spent token after the grace window means a
   * copy is circulating, so the family dies (docs/plan/01 §3.1).
   */
  async refresh(rawToken: string | undefined, meta: SessionMeta = {}) {
    if (!rawToken) throw new UnauthorizedException();
    const tokenHash = this.hash(rawToken);
    const stored = await this.rtModel.findOne({ tokenHash });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revoked) {
      // A revoked family plus someone still holding a token: assume compromise.
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Session revoked. Please sign in again.');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (stored.usedAt) {
      const age = Date.now() - stored.usedAt.getTime();
      if (age > ROTATION_GRACE_MS) {
        await this.revokeFamily(stored.familyId);
        throw new UnauthorizedException(
          'Refresh token reuse detected. All sessions for this login were revoked.',
        );
      }
      // Inside the grace window — a concurrent tab, not an attacker.
    }

    const user = await this.userModel.findById(stored.userId);
    if (!user) throw new UnauthorizedException();
    if (user.blocked) {
      await this.revokeFamily(stored.familyId);
      throw new ForbiddenException('Your account has been disabled');
    }

    // An admin session must keep proving the user is still an instance admin;
    // demoting someone should not leave a live God Mode session behind.
    if (stored.audience === AUD_ADMIN) {
      const isAdmin = await this.adminModel.exists({ userId: user._id });
      if (!isAdmin) {
        await this.revokeFamily(stored.familyId);
        throw new ForbiddenException('Instance admin access required');
      }
    }

    if (!stored.usedAt) {
      stored.usedAt = new Date();
      await stored.save();
    }

    // Refresh never re-grants step-up: only a password does.
    return this.issueTokens(user, stored.audience, meta, {
      familyId: stored.familyId,
    });
  }

  async logout(rawToken?: string) {
    if (!rawToken) return;
    const stored = await this.rtModel.findOne({ tokenHash: this.hash(rawToken) });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  /** Sign out everywhere — every family, every app. */
  async logoutAll(userId: string) {
    await this.rtModel.updateMany(
      { userId: new Types.ObjectId(userId), revoked: false },
      { $set: { revoked: true } },
    );
  }

  /** One row per live session (family), newest first. */
  async listSessions(userId: string, currentRawToken?: string) {
    const currentHash = currentRawToken ? this.hash(currentRawToken) : null;
    const rows = await this.rtModel
      .find({ userId: new Types.ObjectId(userId), revoked: false })
      .sort({ lastUsedAt: -1 })
      .lean();

    const byFamily = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const seen = byFamily.get(row.familyId);
      if (!seen || row.lastUsedAt > seen.lastUsedAt) byFamily.set(row.familyId, row);
    }

    const currentFamily = rows.find((r) => r.tokenHash === currentHash)?.familyId;

    return [...byFamily.values()].map((row) => ({
      id: row.familyId,
      audience: row.audience,
      ip: row.ip,
      userAgent: row.userAgent,
      lastUsedAt: row.lastUsedAt,
      createdAt: (row as unknown as { createdAt: Date }).createdAt,
      current: row.familyId === currentFamily,
    }));
  }

  async revokeSession(userId: string, familyId: string) {
    const owned = await this.rtModel.exists({
      userId: new Types.ObjectId(userId),
      familyId,
    });
    if (!owned) throw new BadRequestException('Unknown session');
    await this.revokeFamily(familyId);
  }

  /**
   * Mint a token for apps/live: one document, five minutes, useless on the REST
   * API (the JWT strategy only accepts REST audiences). docs/plan/01 §1 S3.
   */
  async mintCollabToken(userId: string, documentName: string) {
    const token = await this.jwt.signAsync(
      { sub: userId, doc: documentName },
      {
        secret: this.cfg.getOrThrow('JWT_ACCESS_SECRET'),
        audience: AUD_COLLAB,
        expiresIn: COLLAB_TTL_SEC,
      },
    );
    return { token, expiresIn: COLLAB_TTL_SEC };
  }

  private async revokeFamily(familyId: string) {
    await this.rtModel.updateMany({ familyId }, { $set: { revoked: true } });
  }

  private async signAccess(
    user: UserDocument,
    audience: RestAudience,
    stepUp: boolean,
  ) {
    const payload: Record<string, unknown> = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };
    if (stepUp) payload.stepUpAt = Math.floor(Date.now() / 1000);

    return this.jwt.signAsync(payload, {
      secret: this.cfg.getOrThrow('JWT_ACCESS_SECRET'),
      audience,
      expiresIn: this.cfg.get('JWT_ACCESS_TTL') ?? '15m',
    });
  }

  private async issueTokens(
    user: UserDocument,
    audience: RestAudience,
    meta: SessionMeta = {},
    opts: { familyId?: string; stepUp?: boolean } = {},
  ) {
    const accessToken = await this.signAccess(user, audience, !!opts.stepUp);
    const refreshToken = crypto.randomBytes(48).toString('hex');

    await this.rtModel.create({
      userId: user._id,
      tokenHash: this.hash(refreshToken),
      familyId: opts.familyId ?? crypto.randomUUID(),
      audience,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      lastUsedAt: new Date(),
    });

    return {
      accessToken,
      refreshToken,
      user: this.users.publicShape(user.toObject ? user.toObject() : user),
    };
  }

  private hash(t: string) {
    return crypto.createHash('sha256').update(t).digest('hex');
  }
}
