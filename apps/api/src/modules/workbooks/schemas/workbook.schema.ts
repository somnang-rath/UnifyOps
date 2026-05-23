import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { UserRole } from '../../../common/decorators/roles.decorator';

export type WorkbookGrantLevel = 'read' | 'edit';

/**
 * A grant targets either a specific user (userId) or a role (role) — exactly one
 * is set. Service-layer validation enforces the XOR; the schema keeps both fields
 * optional so Mongoose can roundtrip either shape.
 */
@Schema({ _id: false })
export class WorkbookGrant {
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId?: Types.ObjectId | null;

  @Prop({
    type: String,
    enum: ['admin', 'cpo', 'marketing', 'sales', 'dev'],
    default: null,
  })
  role?: UserRole | null;

  @Prop({ type: String, enum: ['read', 'edit'], required: true })
  level: WorkbookGrantLevel;
}
const WorkbookGrantSchema = SchemaFactory.createForClass(WorkbookGrant);

export interface SheetRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface SheetMerge extends SheetRange {}

export interface SheetFilterCriterion {
  op: string;
  value?: unknown;
}

export interface SheetFilter {
  range: SheetRange;
  criteria: Record<string, SheetFilterCriterion>;
}

export interface SheetCondFmtRule {
  id: string;
  range: SheetRange;
  type: 'cellIs' | 'colorScale' | 'dataBar' | 'textContains';
  op?: string;
  value?: unknown;
  value2?: unknown;
  style?: Record<string, unknown>;
}

export interface SheetValidationRule {
  id: string;
  range: SheetRange;
  type: 'list' | 'number' | 'date' | 'text' | 'checkbox';
  values?: string[];
  op?: string;
  min?: number;
  max?: number;
  strict?: boolean;
}

@Schema({ _id: false })
class Sheet {
  @Prop({ required: true }) id: string;
  @Prop({ required: true }) name: string;
  @Prop({ default: 100 }) rowCount: number;
  @Prop({ default: 26 }) colCount: number;

  @Prop({ type: Object, default: {} })
  cells: Record<string, unknown>;

  @Prop({ type: Object, default: {} })
  colWidths: Record<string, number>;

  @Prop({ type: Object, default: {} })
  rowHeights: Record<string, number>;

  // ---- View / structural state ----

  @Prop({ type: Object, default: () => ({ rows: 0, cols: 0 }) })
  frozen: { rows: number; cols: number };

  @Prop({ type: [Number], default: [] })
  hiddenRows: number[];

  @Prop({ type: [String], default: [] })
  hiddenCols: string[];

  @Prop({ type: [Object], default: [] })
  merges: SheetMerge[];

  @Prop({ default: true })
  gridlines: boolean;

  @Prop({ type: String, default: null })
  color: string | null;

  @Prop({ default: false })
  hidden: boolean;

  @Prop({ default: 0 })
  index: number;

  // ---- Data state ----

  @Prop({ type: Object, default: null })
  filter: SheetFilter | null;

  @Prop({ type: [Object], default: [] })
  condFmt: SheetCondFmtRule[];

  @Prop({ type: [Object], default: [] })
  validations: SheetValidationRule[];
}
const SheetSchema = SchemaFactory.createForClass(Sheet);

export interface NamedRange {
  name: string;
  sheetId: string;
  range: SheetRange;
}

@Schema({ timestamps: true })
export class Workbook {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: [SheetSchema], default: [] })
  sheets: Sheet[];

  @Prop({ required: true })
  activeSheetId: string;

  @Prop({ type: [WorkbookGrantSchema], default: [] })
  grants: WorkbookGrant[];

  @Prop({ type: [Object], default: [] })
  namedRanges: NamedRange[];

  @Prop({ default: 0 })
  version: number;
}
export type WorkbookDocument = HydratedDocument<Workbook>;
export const WorkbookSchema = SchemaFactory.createForClass(Workbook);
WorkbookSchema.index({ 'grants.userId': 1 });
WorkbookSchema.index({ 'grants.role': 1 });
