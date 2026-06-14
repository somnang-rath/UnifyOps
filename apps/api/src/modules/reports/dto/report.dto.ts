import { z } from 'zod';

const ReportPageSchema = z.object({
  id: z.string(),
  background: z.string().optional(),
  sourceTableId: z.string().optional(), // set by auto-layout; must survive DB round-trip
});

const ReportElementSchema = z.object({
  id: z.string(),
  type: z.enum(['text', 'heading', 'image', 'table', 'grouped-table', 'shape', 'data-widget', 'chart', 'divider', 'page-number', 'progress-bar']),
  x: z.number(),
  y: z.number(),
  w: z.number().min(1),
  h: z.number().min(1),
  rotation: z.number().default(0),
  zIndex: z.number().default(0),
  page: z.number().int().min(0).optional(),
  groupId: z.string().optional(),
  props: z.record(z.unknown()).default({}),
});

const ReportGroupSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200).trim(),
  page: z.number().int().min(0),
  collapsed: z.boolean().optional(),
});

const ReportScheduleSchema = z.object({
  enabled: z.boolean().default(false),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']).default('monthly'),
  hour: z.number().min(0).max(23).default(8),
  dayOfWeek: z.number().min(0).max(6).optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  month: z.number().min(1).max(12).optional(),
});

const ReportRecipientSchema = z
  .object({
    userId: z.string().optional(),
    email: z.string().email().optional(),
    canDownload: z.boolean().default(true),
    formats: z.array(z.enum(['pdf', 'xlsx'])).default(['pdf']),
    /** The value that identifies this recipient's rows in the external API data.
     *  E.g. "support@greenenergy.com" when fieldPath is "email". */
    filterValue: z.string().max(500).optional(),
  })
  .refine((d) => d.userId || d.email, { message: 'userId or email is required' });

const ReportPermissionsSchema = z.object({
  allowDownload: z.boolean().default(true),
  allowedFormats: z.array(z.enum(['pdf', 'xlsx'])).default(['pdf']),
});

// ── Auto-recipients from API data ─────────────────────────────────────────────

/**
 * When enabled, recipients are auto-extracted from the API JSON array at send time.
 * The emailField (e.g. "email") is read from every row; each row owner receives
 * a personalised PDF containing only their own data.
 */
const ReportDataRecipientsConfigSchema = z.object({
  enabled:    z.boolean().default(false),
  /** Dot-notation path to the email field in each row, e.g. "email" or "contact.email". */
  emailField: z.string().max(200).default(''),
  /** Optional display-name field, e.g. "cpo_name". */
  nameField:  z.string().max(200).default('').optional(),
  /** Dot-notation path to the array inside the JSON response. Empty = root is the array. */
  dataPath:   z.string().max(200).default('').optional(),
  /** Optional dedicated URL for recipient extraction (defaults to first element dataSource). */
  url:        z.string().url().optional().or(z.literal('')).optional(),
});

// ── Recipient data-filter ─────────────────────────────────────────────────────

/** Controls whether each recipient receives a PDF filtered to their own rows. */
const ReportRecipientDataFilterSchema = z.object({
  enabled: z.boolean().default(false),
  /** Dot-notation field path in each array row, e.g. "email" or "cpo_id". */
  fieldPath: z.string().max(200).default(''),
});

// ── Per-Recipient URL mode ────────────────────────────────────────────────────

/**
 * Fetch a dedicated URL per CPO using their unique ID extracted from a list endpoint.
 * dataUrlTemplate must contain the literal {id} placeholder.
 */
const ReportPerRecipientUrlConfigSchema = z.object({
  enabled:         z.boolean().default(false),
  listUrl:         z.string().url().optional().or(z.literal('')).default(''),
  listDataPath:    z.string().max(200).default(''),
  idField:         z.string().max(200).default('id'),
  emailField:      z.string().max(200).default('email'),
  nameField:       z.string().max(200).default(''),
  dataUrlTemplate: z.string().max(2000).default(''),
});

// ── Blocklist ─────────────────────────────────────────────────────────────────

/** A stored blocklist entry inside the template (includes server-assigned id + timestamp). */
const ReportBlocklistEntrySchema = z
  .object({
    id: z.string(),
    email: z.string().email().nullish(),
    userId: z.string().nullish(),
    reason: z.string().max(500).default(''),
    addedAt: z.string(),
  })
  .refine((d) => d.email || d.userId, { message: 'email or userId required' });

// ── Page setup ─────────────────────────────────────────────────────────────────

const ReportMarginsSchema = z.object({
  top:    z.number().min(0).max(500).default(0),
  right:  z.number().min(0).max(500).default(0),
  bottom: z.number().min(0).max(500).default(0),
  left:   z.number().min(0).max(500).default(0),
});

const HFSectionSchema = z.object({
  type:                 z.enum(['empty', 'text', 'image', 'page-number', 'date']).default('empty'),
  text:                 z.string().max(2000).optional(),
  fontSize:             z.number().min(6).max(72).optional(),
  bold:                 z.boolean().optional(),
  italic:               z.boolean().optional(),
  underline:            z.boolean().optional(),
  color:                z.string().optional(),
  align:                z.enum(['left', 'center', 'right']).optional(),
  imageUrl:             z.string().max(2_000_000).optional(), // supports base64 data URLs (~1.5 MB image)
  imageHeight:          z.number().min(8).max(200).optional(),
  imageWidth:           z.number().min(0).max(800).optional(),
  imageFit:             z.enum(['contain', 'cover', 'fill']).optional(),
  pageNumberFormat:     z.enum(['page-x', 'x-of-y', 'x']).optional(),
  pageNumberTemplate:   z.string().max(200).optional(),
  dateFormat:           z.enum(['full', 'short', 'month-year', 'year']).optional(),
});

const ReportHeaderSchema = z.object({
  enabled:       z.boolean().default(false),
  height:        z.number().min(20).max(300).default(50),
  background:    z.string().default('#ffffff'),
  padding:       z.number().min(0).max(60).optional(),
  paddingTop:    z.number().min(0).max(60).optional(),
  paddingBottom: z.number().min(0).max(60).optional(),
  paddingLeft:   z.number().min(0).max(60).optional(),
  paddingRight:  z.number().min(0).max(60).optional(),
  borderBottom: z.boolean().optional(),
  borderColor:  z.string().optional(),
  borderWidth:  z.number().min(1).max(8).optional(),
  left:         HFSectionSchema.optional(),
  center:       HFSectionSchema.optional(),
  right:        HFSectionSchema.optional(),
  showOn:       z.enum(['all', 'except-first', 'custom']).optional(),
  skipPages:    z.array(z.number().int().min(0)).optional(),
  // Legacy flat fields
  content:    z.string().max(2000).optional(),
  color:      z.string().optional(),
  fontSize:   z.number().min(8).max(72).optional(),
  bold:       z.boolean().optional(),
  align:      z.enum(['left', 'center', 'right']).optional(),
});

const ReportFooterSchema = z.object({
  enabled:       z.boolean().default(false),
  height:        z.number().min(20).max(300).default(40),
  background:    z.string().default('#ffffff'),
  padding:       z.number().min(0).max(60).optional(),
  paddingTop:    z.number().min(0).max(60).optional(),
  paddingBottom: z.number().min(0).max(60).optional(),
  paddingLeft:   z.number().min(0).max(60).optional(),
  paddingRight:  z.number().min(0).max(60).optional(),
  borderTop:    z.boolean().optional(),
  borderColor:  z.string().optional(),
  borderWidth:  z.number().min(1).max(8).optional(),
  left:         HFSectionSchema.optional(),
  center:       HFSectionSchema.optional(),
  right:        HFSectionSchema.optional(),
  showOn:       z.enum(['all', 'except-first', 'custom']).optional(),
  skipPages:    z.array(z.number().int().min(0)).optional(),
  // Legacy flat fields
  content:          z.string().max(2000).optional(),
  color:            z.string().optional(),
  fontSize:         z.number().min(8).max(72).optional(),
  bold:             z.boolean().optional(),
  align:            z.enum(['left', 'center', 'right']).optional(),
  showPageNumber:   z.boolean().optional(),
  pageNumberFormat: z.enum(['page-x', 'x-of-y', 'x']).optional(),
  pageNumberAlign:  z.enum(['left', 'center', 'right']).optional(),
});

export const CreateReportTemplateSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).default(''),
  thumbnail: z.string().default(''),
  pageSize: z.enum(['A4', 'Letter', 'A3']).default('A4'),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  background: z.string().default('#ffffff'),
  elements: z.array(ReportElementSchema).default([]),
  pages: z.array(ReportPageSchema).default([]),
  groups: z.array(ReportGroupSchema).default([]),
  schedule: ReportScheduleSchema.default({}),
  recipients: z.array(ReportRecipientSchema).default([]),
  dataRecipientsConfig: ReportDataRecipientsConfigSchema.default({}),
  recipientDataFilter: ReportRecipientDataFilterSchema.default({}),
  perRecipientUrlConfig: ReportPerRecipientUrlConfigSchema.default({}),
  blocklist: z.array(ReportBlocklistEntrySchema).default([]),
  permissions: ReportPermissionsSchema.default({}),
  margins: ReportMarginsSchema.default({}),
  header:  ReportHeaderSchema.default({}),
  footer:  ReportFooterSchema.default({}),
  isTemplate: z.boolean().optional(),
});

export const UpdateReportTemplateSchema = CreateReportTemplateSchema.partial();

export type CreateReportTemplateDto = z.infer<typeof CreateReportTemplateSchema>;
export type UpdateReportTemplateDto = z.infer<typeof UpdateReportTemplateSchema>;

// ── Fetch datasource ──────────────────────────────────────────────────────────

export const FetchDatasourceSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

export type FetchDatasourceDto = z.infer<typeof FetchDatasourceSchema>;

// ── Blocklist management ──────────────────────────────────────────────────────

/**
 * Body for POST /reports/:id/blocklist
 * The server auto-generates id + addedAt.
 */
export const AddBlocklistEntrySchema = z
  .object({
    email: z.string().email().optional(),
    userId: z.string().optional(),
    reason: z.string().max(500).default(''),
  })
  .refine((d) => d.email || d.userId, { message: 'email or userId required' });

export type AddBlocklistEntryDto = z.infer<typeof AddBlocklistEntrySchema>;

// ── Access grants ─────────────────────────────────────────────────────────────

/**
 * Body for POST /reports/:id/grants
 * Must supply either userId (specific user) or role (whole team).
 */
export const AddGrantSchema = z
  .object({
    userId: z.string().optional(),
    role: z.string().max(100).optional(),
    level: z.enum(['view', 'edit']).default('view'),
  })
  .refine((d) => d.userId || d.role, { message: 'userId or role is required' });

export type AddGrantDto = z.infer<typeof AddGrantSchema>;
