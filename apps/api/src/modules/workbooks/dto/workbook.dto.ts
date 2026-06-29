import { z } from 'zod';

const CellStyleSchema = z
  .object({
    b: z.boolean().optional(),
    i: z.boolean().optional(),
    s: z.boolean().optional(),
    u: z.boolean().optional(),
    fs: z.number().min(6).max(72).optional(),
    ff: z.string().max(80).optional(),
    fg: z.string().optional(),
    bg: z.string().optional(),
    ha: z.enum(['left', 'center', 'right']).optional(),
    va: z.enum(['top', 'middle', 'bottom']).optional(),
    nf: z.string().optional(),
    dp: z.number().int().min(0).max(20).optional(),
    wrap: z.boolean().optional(),
  })
  .partial();

const BorderSchema = z.object({
  style: z.enum(['thin', 'medium', 'thick', 'dashed', 'dotted']),
  color: z.string().max(20).default('#000'),
});

const CellImageSchema = z.object({
  // Inline data-URL or an external https URL.
  src: z.string().max(8 * 1024 * 1024),
  alt: z.string().max(200).optional(),
});

const CellLinkSchema = z.object({
  url: z.string().max(2000),
  text: z.string().max(500).optional(),
});

const CellSchema = z
  .object({
    v: z
      .union([z.string(), z.number(), z.boolean()])
      .nullable()
      .optional(),
    f: z.string().nullable().optional(),
    s: CellStyleSchema.optional(),
    img: CellImageSchema.optional(),
    link: CellLinkSchema.optional(),
    note: z.string().max(2000).optional(),
    // Per-cell borders. b1=top, b2=right, b3=bottom, b4=left.
    b1: BorderSchema.optional(),
    b2: BorderSchema.optional(),
    b3: BorderSchema.optional(),
    b4: BorderSchema.optional(),
  })
  .partial();

const RangeSchema = z.object({
  r1: z.number().int().min(0),
  c1: z.number().int().min(0),
  r2: z.number().int().min(0),
  c2: z.number().int().min(0),
});

const FrozenSchema = z.object({
  rows: z.number().int().min(0).max(1000).default(0),
  cols: z.number().int().min(0).max(500).default(0),
});

const FilterCriterionSchema = z.object({
  op: z.string().max(20),
  value: z.unknown().optional(),
});

const SheetFilterSchema = z.object({
  range: RangeSchema,
  criteria: z.record(FilterCriterionSchema).default({}),
});

const CondFmtRuleSchema = z.object({
  id: z.string().min(1).max(40),
  range: RangeSchema,
  type: z.enum(['cellIs', 'colorScale', 'dataBar', 'textContains']),
  op: z.string().max(20).optional(),
  value: z.unknown().optional(),
  value2: z.unknown().optional(),
  style: CellStyleSchema.optional(),
});

const ValidationRuleSchema = z.object({
  id: z.string().min(1).max(40),
  range: RangeSchema,
  type: z.enum(['list', 'number', 'date', 'text', 'checkbox']),
  values: z.array(z.string().max(200)).optional(),
  op: z.string().max(20).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  strict: z.boolean().optional(),
});

const ChartSchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(['column', 'bar', 'line', 'area', 'pie', 'scatter']),
  title: z.string().max(200).optional(),
  range: RangeSchema,
  headerRow: z.boolean().default(true),
  headerCol: z.boolean().default(true),
  legend: z.boolean().default(true),
  stacked: z.boolean().default(false),
  x: z.number().default(40),
  y: z.number().default(40),
  w: z.number().min(160).max(2000).default(480),
  h: z.number().min(120).max(2000).default(300),
});

const MAX_CELLS_PER_SHEET = 100_000;

const SheetSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(60),
  rowCount: z.number().int().min(1).max(10000).default(100),
  colCount: z.number().int().min(1).max(500).default(26),
  cells: z
    .record(CellSchema)
    .default({})
    .superRefine((cells, ctx) => {
      if (Object.keys(cells).length > MAX_CELLS_PER_SHEET) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: MAX_CELLS_PER_SHEET,
          type: 'array',
          inclusive: true,
          message: `Sheet exceeds ${MAX_CELLS_PER_SHEET.toLocaleString()} cells`,
        });
      }
    }),
  colWidths: z.record(z.number()).default({}),
  rowHeights: z.record(z.number()).default({}),

  // View / structural
  frozen: FrozenSchema.default({ rows: 0, cols: 0 }),
  hiddenRows: z.array(z.number().int().min(0)).default([]),
  hiddenCols: z.array(z.string().max(8)).default([]),
  merges: z.array(RangeSchema).default([]),
  gridlines: z.boolean().default(true),
  color: z.string().max(20).nullable().default(null),
  hidden: z.boolean().default(false),
  index: z.number().int().min(0).default(0),

  // Data
  filter: SheetFilterSchema.nullable().default(null),
  condFmt: z.array(CondFmtRuleSchema).default([]),
  validations: z.array(ValidationRuleSchema).default([]),
  charts: z.array(ChartSchema).max(50).default([]),
});

const NamedRangeSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  sheetId: z.string().min(1).max(40),
  range: RangeSchema,
});

export const CreateWorkbookSchema = z.object({
  name: z.string().min(1).max(120).trim(),
});
export type CreateWorkbookDto = z.infer<typeof CreateWorkbookSchema>;

const MAX_SHEETS = 50;
const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024; // 8 MB serialised

export const UpdateWorkbookSchema = z
  .object({
    name: z.string().min(1).max(120).trim().optional(),
    sheets: z.array(SheetSchema).max(MAX_SHEETS).optional(),
    activeSheetId: z.string().min(1).optional(),
    namedRanges: z.array(NamedRangeSchema).optional(),
    // Client may include the version it last saw so the server can detect
    // concurrent edits. Optional during the migration window.
    version: z.number().int().min(0).optional(),
  })
  .superRefine((body, ctx) => {
    const bytes = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (bytes > MAX_WORKBOOK_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Workbook payload exceeds the ${MAX_WORKBOOK_BYTES / 1024 / 1024} MB limit. ` +
          'Remove unused sheets or reduce cell data.',
        path: ['sheets'],
      });
    }
  });
export type UpdateWorkbookDto = z.infer<typeof UpdateWorkbookSchema>;

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/);

export const WorkbookGrantLevelSchema = z.enum(['read', 'edit']);
export type WorkbookGrantLevelDto = z.infer<typeof WorkbookGrantLevelSchema>;

export const WorkbookGrantRoleSchema = z.enum([
  'admin',
  'cpo',
  'marketing',
  'sales',
  'dev',
]);
export type WorkbookGrantRoleDto = z.infer<typeof WorkbookGrantRoleSchema>;

/**
 * Share targets either a user (userId) or a role — exactly one. The discriminated
 * union ensures the controller body always carries one valid shape.
 */
export const ShareWorkbookSchema = z
  .object({
    userId: objectId.optional(),
    role: WorkbookGrantRoleSchema.optional(),
    level: WorkbookGrantLevelSchema,
  })
  .refine((v) => (v.userId ? !v.role : !!v.role), {
    message: 'Specify exactly one of userId or role',
    path: ['userId'],
  });
export type ShareWorkbookDto = z.infer<typeof ShareWorkbookSchema>;
