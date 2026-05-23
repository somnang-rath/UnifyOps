import { z } from 'zod';

const nullableString = (max: number) =>
  z
    .string()
    .max(max)
    .trim()
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

export const UpdateProfileSchema = z.object({
  name: z.string().min(1).max(60).trim().optional(),
  avatar: z.string().max(2_000_000).optional(),
  accent: z.string().min(1).max(20).optional(),
  theme: z.enum(['dark', 'light']).optional(),
  density: z.enum(['comfy', 'compact']).optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  dateOfBirth: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .nullable()
    .optional(),
  nationality: nullableString(60),
  jobTitle: nullableString(80),
  department: nullableString(80),
  employmentType: z
    .enum(['full-time', 'part-time', 'contract'])
    .nullable()
    .optional(),
});
export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;

export const NotifPrefValueSchema = z
  .object({
    inApp: z.boolean().optional(),
    email: z.boolean().optional(),
  })
  .strict();

export const UpdateNotifPrefsSchema = z
  .record(z.string().min(1).max(40), NotifPrefValueSchema)
  .refine((v) => Object.keys(v).length <= 20, {
    message: 'Too many keys',
  });
export type UpdateNotifPrefsDto = z.infer<typeof UpdateNotifPrefsSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72),
});
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;

export const Confirm2FASchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type Confirm2FADto = z.infer<typeof Confirm2FASchema>;

export const CreateApiTokenSchema = z.object({
  name: z.string().min(1).max(60).trim(),
});
export type CreateApiTokenDto = z.infer<typeof CreateApiTokenSchema>;

export const AdminUpdateUserSchema = z
  .object({
    name: z.string().min(1).max(60).trim().optional(),
    role: z
      .string()
      .min(2)
      .max(24)
      .regex(/^[a-z][a-z0-9_-]*$/)
      .trim()
      .toLowerCase()
      .optional(),
    blocked: z.boolean().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.role !== undefined || v.blocked !== undefined,
    { message: 'Nothing to update' },
  );
export type AdminUpdateUserDto = z.infer<typeof AdminUpdateUserSchema>;

export const InviteUserSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  email: z.string().email().toLowerCase().trim(),
  role: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-z][a-z0-9_-]*$/)
    .trim()
    .toLowerCase()
    .default('member'),
});
export type InviteUserDto = z.infer<typeof InviteUserSchema>;
