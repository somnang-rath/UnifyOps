import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

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

export interface ReportPage {
  id: string;
  background?: string;
  sourceTableId?: string;
}

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
  imageFit?: 'contain' | 'cover' | 'fill';
  pageNumberFormat?: 'page-x' | 'x-of-y' | 'x';
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
  content?: string;
  color?: string;
  fontSize?: number;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  showPageNumber?: boolean;
  pageNumberFormat?: 'page-x' | 'x-of-y' | 'x';
  pageNumberAlign?: 'left' | 'center' | 'right';
}

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
  groupId?: string;
  props: Record<string, unknown>;
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
  userId?: Types.ObjectId;  // internal user (looked up by ID)
  email?: string;           // external customer (direct address)
  canDownload: boolean;
  formats: ReportFormat[];
  /** Value used to filter external API data rows for this recipient.
   *  E.g. if the API array has { email: "x@y.com", ... }, set filterValue = "x@y.com"
   *  so only their rows are included in the generated PDF. */
  filterValue?: string;
}

/** Controls how external API data is filtered per recipient. */
export interface ReportRecipientDataFilter {
  enabled: boolean;
  /** Dot-notation path inside each array row to match against recipient.filterValue.
   *  E.g. "email" or "cpo_id" or "charger_locations.location_id" */
  fieldPath: string;
}

/**
 * Auto-recipients mode:
 * Instead of manually adding recipients, the system reads the API data,
 * extracts the email field from every row, and sends each row's data
 * as a personalised PDF to the owner of that row.
 *
 * Example: API returns [{email:"a@b.com", ...}, {email:"c@d.com", ...}]
 *   → system automatically sends to a@b.com (only their row) and c@d.com (only their row)
 *   → no manual recipient setup required
 */
export interface ReportDataRecipientsConfig {
  /** Master switch. When false the old manual recipients[] list is used. */
  enabled: boolean;
  /**
   * Dot-notation path to the email field inside each array item.
   * E.g. "email"  →  item.email
   *      "contact.email"  →  item.contact.email
   */
  emailField: string;
  /**
   * Optional: dot-notation path to a display-name field.
   * Used in the email subject/body. E.g. "cpo_name"
   */
  nameField?: string;
  /**
   * Optional: dot-notation path to the array within the API response.
   * Leave empty ("") when the root of the response IS the array.
   * E.g. "data.cpos" when response is { data: { cpos: [...] } }
   */
  dataPath?: string;
  /**
   * Optional dedicated URL for recipient extraction.
   * When empty the first dataSource URL found in the elements is used.
   * Useful when the recipient list comes from a different endpoint
   * than the element data.
   */
  url?: string;
}

/**
 * Per-Recipient URL mode:
 * Instead of filtering one shared dataset, fetch a dedicated URL per CPO using
 * their unique ID.  Steps at send time:
 *   1. GET listUrl → array of CPO objects
 *   2. For each CPO: extract id, email, optional name
 *   3. Compute concreteUrl = dataUrlTemplate.replace('{id}', cpoId)
 *   4. GET concreteUrl → this CPO's own dataset
 *   5. Render all data-source elements using that dataset (no row filtering)
 *   6. Send personalised PDF to CPO's email
 */
export interface ReportPerRecipientUrlConfig {
  /** Master switch. */
  enabled: boolean;
  /** URL returning the full list of CPOs. E.g. https://api.example.com/cpos */
  listUrl: string;
  /** Dot-notation path to the array inside the list response. Empty = root is the array. */
  listDataPath: string;
  /** Field in each list row containing the CPO's unique ID. E.g. "id" or "_id" */
  idField: string;
  /** Field in each list row containing the CPO's email address. E.g. "email" */
  emailField: string;
  /** Optional display-name field. E.g. "name" or "company_name" */
  nameField: string;
  /** URL template with {id} placeholder. E.g. https://api.example.com/cpos/{id} */
  dataUrlTemplate: string;
}

/** An entry in the report send blocklist — any recipient matching this is skipped. */
export interface ReportBlocklistEntry {
  /** UUID generated on creation */
  id: string;
  email?: string;
  userId?: Types.ObjectId;
  reason?: string;
  addedAt: string; // ISO timestamp
}

export interface ReportPermissions {
  allowDownload: boolean;
  allowedFormats: ReportFormat[];
}

export type ReportTemplateDocument = HydratedDocument<ReportTemplate>;

@Schema({ timestamps: true })
export class ReportTemplate {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ default: '' })
  thumbnail: string;

  @Prop({ default: 'A4' })
  pageSize: ReportPageSize;

  @Prop({ default: 'portrait' })
  orientation: ReportOrientation;

  @Prop({ default: '#ffffff' })
  background: string;

  @Prop({ type: Object, default: [] })
  elements: ReportElement[];

  @Prop({ type: Object, default: [] })
  pages: ReportPage[];

  @Prop({ type: Object, default: [] })
  groups: ReportGroup[];

  @Prop({ type: Object, default: { enabled: false, frequency: 'monthly', hour: 8 } })
  schedule: ReportSchedule;

  @Prop({ type: Object, default: [] })
  recipients: ReportRecipient[];

  /**
   * Auto-recipients mode — extract email addresses directly from the API data.
   * When enabled, the template.recipients[] list is ignored for sending;
   * recipients are derived from the fetched JSON rows at send time.
   */
  @Prop({ type: Object, default: { enabled: false, emailField: '', nameField: '', dataPath: '', url: '' } })
  dataRecipientsConfig: ReportDataRecipientsConfig;

  /** When enabled, each recipient receives a PDF filtered to only their data rows. */
  @Prop({ type: Object, default: { enabled: false, fieldPath: '' } })
  recipientDataFilter: ReportRecipientDataFilter;

  /** Per-Recipient URL mode — fetch a dedicated URL per CPO using their unique ID. */
  @Prop({ type: Object, default: { enabled: false, listUrl: '', listDataPath: '', idField: 'id', emailField: 'email', nameField: '', dataUrlTemplate: '' } })
  perRecipientUrlConfig: ReportPerRecipientUrlConfig;

  /** Users / emails that should NEVER receive this report. */
  @Prop({ type: Object, default: [] })
  blocklist: ReportBlocklistEntry[];

  @Prop({ type: Object, default: { allowDownload: true, allowedFormats: ['pdf'] } })
  permissions: ReportPermissions;

  @Prop({ type: Object, default: { top: 0, right: 0, bottom: 0, left: 0 } })
  margins: ReportMargins;

  @Prop({ type: Object, default: { enabled: false, height: 50, content: '', background: '#ffffff', color: '#111111', fontSize: 12, bold: false, align: 'left' } })
  header: ReportHeader;

  @Prop({ type: Object, default: { enabled: false, height: 40, content: '', background: '#ffffff', color: '#6b7280', fontSize: 11, bold: false, align: 'left', showPageNumber: true, pageNumberFormat: 'x-of-y', pageNumberAlign: 'right' } })
  footer: ReportFooter;
}

export const ReportTemplateSchema = SchemaFactory.createForClass(ReportTemplate);
