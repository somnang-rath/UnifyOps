import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface AuthUserPayload {
  id: string;
  email: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUserPayload =>
    ctx.switchToHttp().getRequest().user,
);
