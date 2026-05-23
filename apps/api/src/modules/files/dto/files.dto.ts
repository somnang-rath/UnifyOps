import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const ListFilesSchema = z.object({
  folderId: objectId.optional().nullable(),
  q: z.string().trim().optional(),
});
export type ListFilesDto = z.infer<typeof ListFilesSchema>;

export const CreateFolderSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  parentId: objectId.optional().nullable(),
});
export type CreateFolderDto = z.infer<typeof CreateFolderSchema>;

export const RenameSchema = z.object({
  name: z.string().min(1).max(120).trim(),
});

export const MoveFileSchema = z.object({
  folderId: objectId.optional().nullable(),
});

export const AddLinkSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  url: z.string().url(),
  folderId: objectId.optional().nullable(),
});
export type AddLinkDto = z.infer<typeof AddLinkSchema>;

export const GrantLevelSchema = z.enum(['none', 'read', 'upload', 'edit']);
export type GrantLevelDto = z.infer<typeof GrantLevelSchema>;

export const GrantRoleSchema = z.enum([
  'admin',
  'cpo',
  'marketing',
  'sales',
  'dev',
]);
export type GrantRoleDto = z.infer<typeof GrantRoleSchema>;

/**
 * Share targets either a user (userId) or a role — exactly one. The discriminated
 * union ensures the controller body always carries one valid shape.
 */
export const ShareFolderSchema = z
  .object({
    userId: objectId.optional(),
    role: GrantRoleSchema.optional(),
    level: GrantLevelSchema,
  })
  .refine((v) => (v.userId ? !v.role : !!v.role), {
    message: 'Specify exactly one of userId or role',
    path: ['userId'],
  });
export type ShareFolderDto = z.infer<typeof ShareFolderSchema>;
