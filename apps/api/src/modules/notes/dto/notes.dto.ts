import { z } from 'zod';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const TableDataSchema = z.object({
  cols: z.number().int().min(1).max(20),
  rows: z.array(z.array(z.string())),
  headerRow: z.boolean().optional(),
});

export const NoteBlockSchema = z.object({
  type: z.enum([
    'text',
    'heading',
    'check',
    'code',
    'image',
    'video',
    'divider',
    'table',
    'file',
  ]),
  value: z.string().default(''),
  checked: z.boolean().optional(),
  lang: z.string().optional(),
  color: z.string().max(32).optional(),
  table: TableDataSchema.optional(),
  fileId: z.string().optional(),
  fileViewSize: z.enum(['sm', 'md', 'lg']).optional(),
});

export const SaveNoteSchema = z.object({
  title: z.string().max(200).default(''),
  emoji: z.string().max(64).default('📄'),
  blocks: z.array(NoteBlockSchema).default([]),
  tags: z.array(z.string().min(1).max(40)).default([]),
  pinned: z.boolean().default(false),
  folderId: objectId.optional().nullable(),
});
export type SaveNoteDto = z.infer<typeof SaveNoteSchema>;

export const UpdateNoteSchema = SaveNoteSchema.partial();
export type UpdateNoteDto = z.infer<typeof UpdateNoteSchema>;

export const CreateFolderSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  parentId: objectId.optional().nullable(),
});
export type CreateFolderDto = z.infer<typeof CreateFolderSchema>;

export const RenameFolderSchema = z.object({
  name: z.string().min(1).max(120).trim(),
});

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

export const ShareNoteFolderSchema = z
  .object({
    userId: objectId.optional(),
    role: GrantRoleSchema.optional(),
    level: GrantLevelSchema,
  })
  .refine((v) => (v.userId ? !v.role : !!v.role), {
    message: 'Specify exactly one of userId or role',
    path: ['userId'],
  });
export type ShareNoteFolderDto = z.infer<typeof ShareNoteFolderSchema>;
