import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import * as QRCode from 'qrcode';
import { User, UserDocument } from './schemas/user.schema';
import { ApiToken, ApiTokenDocument } from './schemas/api-token.schema';
import {
  AdminUpdateUserDto,
  ChangePasswordDto,
  Confirm2FADto,
  CreateApiTokenDto,
  InviteUserDto,
  UpdateNotifPrefsDto,
  UpdateProfileDto,
} from './dto/users.dto';
import {
  mergeNotifPrefs,
  type NotifPrefs,
} from '../notifications/notif-prefs';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(ApiToken.name) private apiTokenModel: Model<ApiTokenDocument>,
  ) {}

  findById(id: string) {
    return this.userModel.findById(id);
  }

  async byId(id: string) {
    const u = await this.userModel.findById(id).lean();
    if (!u) throw new NotFoundException();
    return this.publicShape(u);
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email }).select('+passwordHash');
  }

  async findByEmailLocalParts(
    parts: string[],
  ): Promise<{ id: string; email: string }[]> {
    const unique = Array.from(
      new Set(parts.map((p) => p.toLowerCase().trim()).filter(Boolean)),
    );
    if (unique.length === 0) return [];
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const orFilters = unique.map((p) => ({
      email: new RegExp(`^${escape(p)}@`, 'i'),
    }));
    const users = await this.userModel
      .find({ $or: orFilters })
      .select('email')
      .lean();
    return users.map((u) => ({ id: String(u._id), email: u.email }));
  }

  async list() {
    const users = await this.userModel.find().sort({ name: 1 }).lean();
    return users.map((u) => this.publicShape(u));
  }

  async findByRole(role: string): Promise<{ id: string; email: string }[]> {
    const users = await this.userModel
      .find({ role: role.toLowerCase().trim(), blocked: false })
      .select('email')
      .lean();
    return users.map((u) => ({ id: String(u._id), email: u.email }));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const u = await this.userModel.findById(userId);
    if (!u) throw new NotFoundException();
    if (dto.name !== undefined) u.name = dto.name;
    if (dto.avatar !== undefined) u.avatar = dto.avatar;
    if (dto.accent !== undefined) u.accent = dto.accent;
    if (dto.theme !== undefined) u.theme = dto.theme;
    if (dto.density !== undefined) u.density = dto.density;
    if (dto.gender !== undefined) u.gender = dto.gender;
    if (dto.dateOfBirth !== undefined)
      u.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    if (dto.nationality !== undefined) u.nationality = dto.nationality;
    if (dto.jobTitle !== undefined) u.jobTitle = dto.jobTitle;
    if (dto.department !== undefined) u.department = dto.department;
    if (dto.employmentType !== undefined)
      u.employmentType = dto.employmentType;
    await u.save();
    return this.publicShape(u.toObject());
  }

  async remove(id: string) {
    const u = await this.userModel.findByIdAndDelete(id);
    if (!u) throw new NotFoundException();
    return { ok: true };
  }

  /** Admin-only mutation: assign role and/or toggle blocked.
   *  - Caller must not target itself (we'd lock the admin out).
   *  - When demoting an admin or blocking one, refuse if it would leave
   *    zero active admins.
   *  - `roleExists` is supplied by the controller so we don't create a
   *    cyclic dependency between Users and Roles modules.
   */
  async adminUpdate(
    actorId: string,
    targetId: string,
    dto: AdminUpdateUserDto,
    roleExists: (key: string) => Promise<boolean>,
  ) {
    if (actorId === targetId)
      throw new BadRequestException('You cannot modify your own account here');

    const u = await this.userModel.findById(targetId);
    if (!u) throw new NotFoundException();

    if (dto.name !== undefined && dto.name !== u.name) {
      u.name = dto.name;
    }

    if (dto.role !== undefined && dto.role !== u.role) {
      if (!(await roleExists(dto.role)))
        throw new BadRequestException(`Unknown role "${dto.role}"`);
      if (u.role === 'admin' && dto.role !== 'admin') {
        await this.assertNotLastAdmin(String(u._id));
      }
      u.role = dto.role;
    }

    if (dto.blocked !== undefined && dto.blocked !== u.blocked) {
      if (dto.blocked && u.role === 'admin') {
        await this.assertNotLastAdmin(String(u._id));
      }
      u.blocked = dto.blocked;
    }

    await u.save();
    return this.publicShape(u.toObject());
  }

  private async assertNotLastAdmin(excludeUserId: string) {
    const remaining = await this.userModel.countDocuments({
      _id: { $ne: excludeUserId },
      role: 'admin',
      blocked: { $ne: true },
    });
    if (remaining === 0)
      throw new ForbiddenException(
        'Cannot remove or block the last active admin',
      );
  }

  async getNotifPrefs(userId: string): Promise<NotifPrefs> {
    const u = await this.userModel
      .findById(userId)
      .select('notifPrefs')
      .lean();
    return mergeNotifPrefs(u?.notifPrefs);
  }

  async updateNotifPrefs(
    userId: string,
    patch: UpdateNotifPrefsDto,
  ): Promise<NotifPrefs> {
    const u = await this.userModel.findById(userId);
    if (!u) throw new NotFoundException();
    const current = (u.notifPrefs ?? {}) as Record<
      string,
      { inApp?: boolean; email?: boolean }
    >;
    const next: Record<string, { inApp?: boolean; email?: boolean }> = {
      ...current,
    };
    for (const [k, v] of Object.entries(patch)) {
      next[k] = { ...(current[k] ?? {}), ...v };
    }
    u.notifPrefs = next;
    u.markModified('notifPrefs');
    await u.save();
    return mergeNotifPrefs(next);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const u = await this.userModel
      .findById(userId)
      .select('+passwordHash');
    if (!u) throw new NotFoundException();
    const ok = await bcrypt.compare(dto.currentPassword, u.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    u.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await u.save();
    return { ok: true };
  }

  async setup2FA(userId: string) {
    const u = await this.userModel.findById(userId);
    if (!u) throw new NotFoundException();
    if (u.twoFactorEnabled)
      throw new BadRequestException('2FA is already enabled');
    const generated = speakeasy.generateSecret({
      name: `UnifyOps (${u.email})`,
      length: 20,
    });
    const base32Secret = generated.base32;
    await this.userModel.findByIdAndUpdate(userId, {
      twoFactorPending: base32Secret,
    });
    const otpauth = speakeasy.otpauthURL({
      secret: base32Secret,
      label: u.email,
      issuer: 'UnifyOps Workspace',
      encoding: 'base32',
    });
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { secret: base32Secret, qrDataUrl };
  }

  async confirm2FA(userId: string, dto: Confirm2FADto) {
    const u = await this.userModel.findById(userId).lean();
    if (!u) throw new NotFoundException();
    if (!u.twoFactorPending)
      throw new BadRequestException('2FA setup not started — click Enable first');
    const valid = speakeasy.totp.verify({
      secret: u.twoFactorPending,
      encoding: 'base32',
      token: dto.code,
      window: 4,
    });
    if (!valid) throw new BadRequestException('Invalid code — check your authenticator app and try again');
    await this.userModel.findByIdAndUpdate(userId, {
      twoFactorSecret: u.twoFactorPending,
      twoFactorPending: null,
      twoFactorEnabled: true,
    });
    return { ok: true };
  }

  async generateRecoveryCodes(userId: string, dto: Confirm2FADto) {
    const u = await this.userModel.findById(userId).lean();
    if (!u) throw new NotFoundException();
    if (!u.twoFactorEnabled || !u.twoFactorSecret)
      throw new BadRequestException('2FA is not enabled');
    const valid = speakeasy.totp.verify({
      secret: u.twoFactorSecret,
      encoding: 'base32',
      token: dto.code,
      window: 4,
    });
    if (!valid) throw new BadRequestException('Invalid code');
    const codes = Array.from({ length: 8 }, () =>
      crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'),
    );
    const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    await this.userModel.findByIdAndUpdate(userId, { twoFactorRecoveryCodes: hashed });
    return { codes };
  }

  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    const u = await this.userModel.findById(userId).select('+twoFactorRecoveryCodes').lean();
    if (!u || !u.twoFactorRecoveryCodes?.length) return false;
    for (let i = 0; i < u.twoFactorRecoveryCodes.length; i++) {
      const match = await bcrypt.compare(code, u.twoFactorRecoveryCodes[i]);
      if (match) {
        const remaining = u.twoFactorRecoveryCodes.filter((_, idx) => idx !== i);
        await this.userModel.findByIdAndUpdate(userId, { twoFactorRecoveryCodes: remaining });
        return true;
      }
    }
    return false;
  }

  async disable2FA(userId: string, dto: Confirm2FADto) {
    const u = await this.userModel.findById(userId).lean();
    if (!u) throw new NotFoundException();
    if (!u.twoFactorEnabled || !u.twoFactorSecret)
      throw new BadRequestException('2FA is not enabled');
    const valid = speakeasy.totp.verify({
      secret: u.twoFactorSecret,
      encoding: 'base32',
      token: dto.code,
      window: 4,
    });
    if (!valid) throw new BadRequestException('Invalid code — check your authenticator app and try again');
    await this.userModel.findByIdAndUpdate(userId, {
      twoFactorSecret: null,
      twoFactorPending: null,
      twoFactorEnabled: false,
    });
    return { ok: true };
  }

  async listApiTokens(userId: string) {
    return this.apiTokenModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .select('-tokenHash')
      .lean();
  }

  async createApiToken(userId: string, dto: CreateApiTokenDto) {
    const raw = `prs_${crypto.randomBytes(32).toString('hex')}`;
    const prefix = raw.slice(0, 12);
    const tokenHash = crypto
      .createHash('sha256')
      .update(raw)
      .digest('hex');
    const doc = await this.apiTokenModel.create({
      userId,
      name: dto.name,
      tokenHash,
      prefix,
    });
    return {
      _id: String(doc._id),
      id: String(doc._id),
      name: doc.name,
      prefix: doc.prefix,
      createdAt: (doc as any).createdAt,
      token: raw,
    };
  }

  async revokeApiToken(userId: string, tokenId: string) {
    const doc = await this.apiTokenModel.findOneAndDelete({
      _id: tokenId,
      userId,
    });
    if (!doc) throw new NotFoundException();
    return { ok: true };
  }

  async inviteUser(
    dto: InviteUserDto,
    roleExists: (key: string) => Promise<boolean>,
  ): Promise<{ user: ReturnType<UsersService['publicShape']>; rawToken: string }> {
    const exists = await this.userModel.exists({ email: dto.email });
    if (exists) throw new ConflictException('Email already in use');

    if (!(await roleExists(dto.role)))
      throw new BadRequestException(`Unknown role "${dto.role}"`);

    const { rawToken, tokenHash, expiry } = this.generateInviteToken();
    const randomPwHash = await bcrypt.hash(
      crypto.randomBytes(32).toString('hex'),
      10,
    );

    const user = await this.userModel.create({
      email: dto.email,
      name: dto.name,
      role: dto.role,
      passwordHash: randomPwHash,
      invitePending: true,
      inviteToken: tokenHash,
      inviteTokenExpiry: expiry,
    });

    return { user: this.publicShape(user.toObject()), rawToken };
  }

  async resendInvite(
    targetId: string,
  ): Promise<{ user: ReturnType<UsersService['publicShape']>; rawToken: string }> {
    const u = await this.userModel.findById(targetId);
    if (!u) throw new NotFoundException();
    if (!u.invitePending)
      throw new BadRequestException('This user has already accepted their invitation');

    const { rawToken, tokenHash, expiry } = this.generateInviteToken();
    u.inviteToken = tokenHash;
    u.inviteTokenExpiry = expiry;
    await u.save();

    return { user: this.publicShape(u.toObject()), rawToken };
  }

  private generateInviteToken() {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
    return { rawToken, tokenHash, expiry };
  }

  publicShape(u: any) {
    return {
      _id: String(u._id),
      id: String(u._id),
      email: u.email,
      name: u.name,
      role: u.role,
      blocked: !!u.blocked,
      avatar: u.avatar,
      accent: u.accent,
      theme: u.theme,
      density: u.density,
      gender: u.gender ?? null,
      dateOfBirth: u.dateOfBirth ?? null,
      nationality: u.nationality ?? null,
      jobTitle: u.jobTitle ?? null,
      department: u.department ?? null,
      employmentType: u.employmentType ?? null,
      twoFactorEnabled: !!u.twoFactorEnabled,
      invitePending: !!u.invitePending,
      createdAt: u.createdAt,
    };
  }
}
