import { z } from 'zod';
import { AUD_ADMIN, AUD_WEB } from '../../../common/auth/audience';

/** Which app the session is for. `admin` is only granted to instance admins. */
export const AudienceSchema = z.enum([AUD_WEB, AUD_ADMIN]).default(AUD_WEB);

export const RegisterSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(72),
  name: z.string().min(1).max(60).trim(),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1).max(72),
  audience: AudienceSchema,
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  audience: AudienceSchema,
});
export type RefreshDto = z.infer<typeof RefreshSchema>;

export const StepUpSchema = z.object({
  password: z.string().min(1).max(72),
});
export type StepUpDto = z.infer<typeof StepUpSchema>;

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(72),
});
export type AcceptInviteDto = z.infer<typeof AcceptInviteSchema>;
