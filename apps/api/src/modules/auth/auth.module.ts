import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import {
  RefreshToken,
  RefreshTokenSchema,
} from './schemas/refresh-token.schema';
import {
  InstanceAdmin,
  InstanceAdminSchema,
} from '../instance/schemas/instance-admin.schema';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({}),
    UsersModule,
    MongooseModule.forFeature([
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      // Schema only, not InstanceModule — an admin-audience login must verify
      // instance admin status without the two modules importing each other.
      { name: InstanceAdmin.name, schema: InstanceAdminSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  // WikiModule mints collab tokens through AuthService.
  exports: [AuthService],
})
export class AuthModule {}
