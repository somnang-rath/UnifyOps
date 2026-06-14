export interface ReportMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HFSection {
  type: 'empty' | 'text' | 'image' | 'page-number' | 'date';
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  imageUrl?: string;
  imageHeight?: number;
  imageWidth?: number;
  imageFit?: 'contain' | 'cover' | 'fill';
  pageNumberFormat?: 'page-x' | 'x-of-y' | 'x';
  // Free-form template: use {n} for current page, {total} for total pages.
  // e.g. "ទំព័រ {n}" or "Note · {n} / {total}". Overrides pageNumberFormat when set.
  pageNumberTemplate?: string;
  dateFormat?: 'full' | 'short' | 'month-year' | 'year';
}

export interface ReportHeader {
  enabled: boolean;
  height: number;
  background: string;
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  borderBottom?: boolean;
  borderColor?: string;
  borderWidth?: number;
  left?: HFSection;
  center?: HFSection;
  right?: HFSection;
  showOn?: 'all' | 'except-first' | 'custom';
  skipPages?: number[];
  // Legacy flat fields (kept for backward compat; ignored when sections are set)
  content?: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface ReportFooter {
  enabled: boolean;
  height: number;
  background: string;
  padding?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  borderTop?: boolean;
  borderColor?: string;
  borderWidth?: number;
  left?: HFSection;
  center?: HFSection;
  right?: HFSection;
  showOn?: 'all' | 'except-first' | 'custom';
  skipPages?: number[];
  // Legacy flat fields (kept for backward compat; ignored when sections are set)
  content?: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  showPageNumber?: boolean;
  pageNumberFormat?: 'page-x' | 'x-of-y' | 'x';
  pageNumberAlign?: 'left' | 'center' | 'right';
}

export type ReportElementType =
  | 'text'
  | 'heading'
  | 'image'
  | 'table'
  | 'grouped-table'
  | 'shape'
  | 'data-widget'
  | 'chart'
  | 'divider'
  | 'page-number'
  | 'progress-bar';

export type ReportPageSize = 'A4' | 'Letter' | 'A3';
export type ReportOrientation = 'portrait' | 'landscape';
export type ReportFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ReportFormat = 'pdf' | 'xlsx';

export type DataWidgetType =
  | 'issues_total'
  | 'issues_open'
  | 'issues_done'
  | 'issues_overdue'
  | 'issues_by_status'
  | 'issues_table'
  | 'projects_total'
  | 'projects_list'
  | 'users_total'
  | 'users_by_department'
  | 'date_label';

export interface ReportGroup {
  id: string;
  name: string;
  page: number;
  collapsed?: boolean;
}

export interface ReportElement {
  id: string;
  type: ReportElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  zIndex: number;
  page?: number; // 0-indexed; undefined = page 0 (backwards compatible)
  groupId?: string; // if set, element belongs to this ReportGroup
  props: Record<string, unknown>;
}

export interface ReportPage {
  id: string;
  background?: string; // overrides template.background when set
  sourceTableId?: string; // set by auto-layout: marks this as an auto-generated page
}

export interface ReportSchedule {
  enabled: boolean;
  frequency: ReportFrequency;
  hour: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  month?: number;
}

export interface ReportRecipient {
  userId?: string;   // internal team member
  email?: string;    // external customer (direct email address)
  canDownload: boolean;
  formats: ReportFormat[];
  /** Value used to filter external API data rows for this recipient.
   *  E.g. set to "support@greenenergy.com" when fieldPath is "email". */
  filterValue?: string;
}

/** Controls per-recipient data filtering from external API sources. */
export interface ReportRecipientDataFilter {
  enabled: boolean;
  /** Dot-notation path in each row, e.g. "email" or "cpo_id". */
  fieldPath: string;
}

/**
 * Auto-recipients mode:
 * The system reads the API data, extracts the email from every row,
 * and sends each row's data as a personalised PDF to that email address.
 * No manual recipient setup required.
 *
 * Example: URL returns [{email:"a@b.com",...},{email:"c@d.com",...}]
 *   → sends to a@b.com (only their row) and c@d.com (only their row)
 */
export interface ReportDataRecipientsConfig {
  /** Master switch. When false, the manual recipients[] list is used. */
  enabled: boolean;
  /** Dot-notation path to the email field in each row. E.g. "email" or "contact.email". */
  emailField: string;
  /** Optional display-name field. E.g. "cpo_name". */
  nameField?: string;
  /** Dot-notation path to the array in the response. Empty = root is the array. */
  dataPath?: string;
  /** Optional dedicated URL for recipient extraction (defaults to first element dataSource). */
  url?: string;
}

/**
 * Per-Recipient URL mode:
 * Fetch a dedicated URL per CPO using their unique ID from a list endpoint.
 * dataUrlTemplate must contain {id} which is replaced per CPO at send time.
 */
export interface ReportPerRecipientUrlConfig {
  enabled: boolean;
  /** URL returning all CPOs. E.g. https://api.example.com/cpos */
  listUrl: string;
  /** Dot-notation path to array in list response. Empty = root is array. */
  listDataPath: string;
  /** Field in each CPO row containing their unique ID. E.g. "id" */
  idField: string;
  /** Field in each CPO row containing their email. E.g. "email" */
  emailField: string;
  /** Optional display-name field. E.g. "name" */
  nameField: string;
  /** URL template with {id} placeholder. E.g. https://api.example.com/cpos/{id} */
  dataUrlTemplate: string;
}

/** Access grant — view/edit access for a specific user or a whole team role. */
export interface ReportGrant {
  id: string;
  /** Set when granting to a specific user. */
  userId?: string;
  /** Set when granting to an entire team role ('admin', 'cpo', 'dev', etc.). */
  role?: string;
  level: 'view' | 'edit';
}

/** An entry in the report send blocklist. */
export interface ReportBlocklistEntry {
  id: string;
  email?: string;
  userId?: string;
  reason?: string;
  addedAt: string;
}

export interface ReportPermissions {
  allowDownload: boolean;
  allowedFormats: ReportFormat[];
}

export interface ReportTemplate {
  _id: string;
  ownerId: string;
  name: string;
  description: string;
  thumbnail: string;
  pageSize: ReportPageSize;
  orientation: ReportOrientation;
  background: string;
  elements: ReportElement[];
  pages?: ReportPage[];
  groups?: ReportGroup[];
  margins?: ReportMargins;
  header?: ReportHeader;
  footer?: ReportFooter;
  schedule: ReportSchedule;
  recipients: ReportRecipient[];
  /**
   * Auto-recipients config — when enabled, recipients come from the API data itself.
   * Set emailField to the JSON path that holds each row's email address.
   */
  dataRecipientsConfig?: ReportDataRecipientsConfig;
  /** Per-recipient data filtering settings (manual mode). */
  recipientDataFilter?: ReportRecipientDataFilter;
  /** Per-Recipient URL mode — fetch a dedicated URL per CPO using their ID. */
  perRecipientUrlConfig?: ReportPerRecipientUrlConfig;
  /** List of users/emails that must never receive this report. */
  blocklist?: ReportBlocklistEntry[];
  permissions: ReportPermissions;
  /** When true, appears as a selectable template in the "New Report" modal. */
  isTemplate?: boolean;
  /** Access grants — users/roles that can view or edit this report. */
  grants?: ReportGrant[];
  createdAt: string;
  updatedAt: string;
}

export type ReportRunStatus = 'pending' | 'generating' | 'done' | 'error';
export type ReportDeliveryStatus = 'success' | 'failed' | 'blocked';

/** Per-recipient delivery record inside a ReportRun. */
export interface ReportDelivery {
  email: string;
  userId?: string;
  status: ReportDeliveryStatus;
  /** Only present when status === 'failed'. */
  error?: string;
  sentAt: string;
  /** How many API data rows were included in this recipient's PDF. */
  filteredRows?: number;
}

export interface ReportRun {
  _id: string;
  templateId: string;
  triggeredBy: 'manual' | 'schedule';
  status: ReportRunStatus;
  fileId: string | null;
  /** Live counters updated incrementally as each delivery completes. */
  totalRecipients: number;
  successCount: number;
  failedCount: number;
  blockedCount: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One record per recipient — fetched from /runs/:runId/deliveries (paginated). */
export interface ReportDeliveryLogEntry {
  _id: string;
  runId: string;
  templateId: string;
  email: string;
  userId: string | null;
  status: ReportDeliveryStatus;
  error: string | null;
  sentAt: string;
  filteredRows: number | null;
  createdAt: string;
}

export interface DeliveryPage {
  items: ReportDeliveryLogEntry[];
  total: number;
  page: number;
  limit: number;
}

// Page canvas sizes in pixels (96 dpi)
export const PAGE_CANVAS_SIZES: Record<ReportPageSize, { w: number; h: number }> = {
  A4: { w: 794, h: 1123 },
  Letter: { w: 816, h: 1056 },
  A3: { w: 1123, h: 1587 },
};

export const DATA_WIDGET_CATALOG: {
  type: DataWidgetType;
  label: string;
  category: string;
  description: string;
}[] = [
  { type: 'issues_total', label: 'Total Issues', category: 'Issues', description: 'Big number card showing total issue count' },
  { type: 'issues_open', label: 'Open Issues', category: 'Issues', description: 'Number of open/unresolved issues' },
  { type: 'issues_done', label: 'Completed Issues', category: 'Issues', description: 'Number of completed issues' },
  { type: 'issues_overdue', label: 'Overdue Issues', category: 'Issues', description: 'Issues past their due date' },
  { type: 'issues_by_status', label: 'Issues by Status', category: 'Issues', description: 'Bar chart breakdown by status' },
  { type: 'issues_table', label: 'Issues Table', category: 'Issues', description: 'Tabular list of recent issues' },
  { type: 'projects_total', label: 'Active Projects', category: 'Projects', description: 'Number of active projects' },
  { type: 'projects_list', label: 'Project Progress', category: 'Projects', description: 'Progress bars per project' },
  { type: 'users_total', label: 'Team Members', category: 'Users', description: 'Total user count' },
  { type: 'users_by_department', label: 'Team by Department', category: 'Users', description: 'Breakdown by department' },
  { type: 'date_label', label: 'Report Period', category: 'General', description: 'Current month/year label' },
];
