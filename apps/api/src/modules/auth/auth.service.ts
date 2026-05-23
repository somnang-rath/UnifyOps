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
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { AcceptInviteDto, LoginDto, RegisterDto } from './dto/auth.dto';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private rtModel: Model<RefreshTokenDocument>,
    private users: UsersService,
    private jwt: JwtService,
    private cfg: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const exists = await this.userModel.exists({ email: dto.email });
    if (exists) throw new ConflictException('Email already in use');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userModel.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
    });
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
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
    return this.issueTokens(user);
  }

  async acceptInvite(dto: AcceptInviteDto) {
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

    return this.issueTokens(user);
  }

  async refresh(rawToken: string | undefined) {
    if (!rawToken) throw new UnauthorizedException();
    const tokenHash = this.hash(rawToken);
    const stored = await this.rtModel.findOne({ tokenHash, revoked: false });
    if (!stored || stored.expiresAt < new Date())
      throw new UnauthorizedException('Invalid refresh token');
    const user = await this.userModel.findById(stored.userId);
    if (!user) throw new UnauthorizedException();
    if (user.blocked) {
      stored.revoked = true;
      await stored.save();
      throw new ForbiddenException('Your account has been disabled');
    }
    // Do not rotate — keep old token valid until expiry.
    // Rotation breaks multi-tab sessions (second tab gets 401 when both
    // try to refresh simultaneously with the same cookie).
    return this.issueTokens(user);
  }

  async logout(rawToken?: string) {
    if (!rawToken) return;
    await this.rtModel.updateOne(
      { tokenHash: this.hash(rawToken) },
      { $set: { revoked: true } },
    );
  }

  private async issueTokens(user: UserDocument) {
    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.cfg.get('JWT_ACCESS_TTL') ?? '15m',
    });
    const refreshToken = crypto.randomBytes(48).toString('hex');
    await this.rtModel.create({
      userId: user._id,
      tokenHash: this.hash(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
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
