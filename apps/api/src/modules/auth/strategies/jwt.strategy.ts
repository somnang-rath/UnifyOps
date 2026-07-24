import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { REST_AUDIENCES, type RestAudience } from '../../../common/auth/audience';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  aud: RestAudience;
  /** Unix seconds of the last password re-entry; only set on `admin` tokens. */
  stepUpAt?: number;
}

export interface AuthedUser {
  id: string;
  email: string;
  role: string;
  aud: RestAudience;
  stepUpAt?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(cfg: ConfigService, private users: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('t'),
      ]),
      secretOrKey: cfg.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
      // Collab tokens are signed with the same secret but carry aud=collab.
      // Listing only the REST audiences makes passport-jwt reject them before
      // validate() runs, so a token minted for apps/live can never drive the API.
      audience: [...REST_AUDIENCES],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    if (user.blocked) throw new UnauthorizedException('Account disabled');
    return {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      aud: payload.aud,
      stepUpAt: payload.stepUpAt,
    };
  }
}
