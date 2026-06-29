export interface CellStyle {
  b?: boolean;
  i?: boolean;
  s?: boolean;
  u?: boolean;
  fs?: number;
  ff?: string;
  fg?: string;
  bg?: string;
  ha?: 'left' | 'center' | 'right';
  va?: 'top' | 'middle' | 'bottom';
  nf?: string;
  dp?: number;
  wrap?: boolean;
}

export interface CellImage {
  src: string;
  alt?: string;
}

export interface CellLink {
  url: string;
  text?: string;
}

export type BorderStyle = 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted';

export interface CellBorder {
  style: BorderStyle;
  color: string;
}

export interface Cell {
  v?: string | number | boolean | null;
  f?: string | null;
  s?: CellStyle;
  img?: CellImage;
  link?: CellLink;
  note?: string;
  b1?: CellBorder;
  b2?: CellBorder;
  b3?: CellBorder;
  b4?: CellBorder;
}

export interface SheetRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface SheetFrozen {
  rows: number;
  cols: number;
}

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
  style?: CellStyle;
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

export type ChartType =
  | 'column'
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'scatter';

export interface SheetChart {
  id: string;
  type: ChartType;
  title?: string;
  range: SheetRange;
  /** First row of the range holds series names. */
  headerRow: boolean;
  /** First column of the range holds category (x-axis) labels. */
  headerCol: boolean;
  legend: boolean;
  /** Stack series (column/bar/area only). */
  stacked: boolean;
  /** Floating position/size in pixels, relative to the grid viewport. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PrintHeaderFooter {
  left: string;
  center: string;
  right: string;
}

export interface PrintSetup {
  paper: 'A4' | 'Letter' | 'Legal' | 'A3';
  orientation: 'portrait' | 'landscape';
  margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
    header: number;
    footer: number;
  };
  scaling: {
    mode: 'percent' | 'fitWidth' | 'fitPage';
    percent: number;
    fitWide: number;
    fitTall: number;
  };
  printArea: SheetRange | null;
  repeatRows: { from: number; to: number } | null;
  repeatCols: { from: number; to: number } | null;
  gridlines: boolean;
  headings: boolean;
  centerH: boolean;
  centerV: boolean;
  order: 'down' | 'over';
  header: PrintHeaderFooter;
  footer: PrintHeaderFooter;
}

export interface Sheet {
  id: string;
  name: string;
  rowCount: number;
  colCount: number;
  cells: Record<string, Cell>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;

  // View / structural
  frozen: SheetFrozen;
  hiddenRows: number[];
  hiddenCols: string[];
  merges: SheetRange[];
  gridlines: boolean;
  color: string | null;
  hidden: boolean;
  index: number;

  // Data
  filter: SheetFilter | null;
  condFmt: SheetCondFmtRule[];
  validations: SheetValidationRule[];
  charts: SheetChart[];

  // Print / page setup (optional; defaults applied client-side)
  printSetup?: PrintSetup | null;
}

export interface NamedRange {
  name: string;
  sheetId: string;
  range: SheetRange;
}

export type WorkbookGrantLevel = 'read' | 'edit';
export type WorkbookAccess = WorkbookGrantLevel | 'owner';
export type WorkbookGrantRole = 'admin' | 'cpo' | 'marketing' | 'sales' | 'dev';

/**
 * A grant targets exactly one of `userId` or `role`. The other field is null —
 * the API resolves grants by checking both shapes when computing access.
 */
export interface WorkbookGrant {
  userId: string | null;
  role: WorkbookGrantRole | null;
  level: WorkbookGrantLevel;
  user: {
    _id: string;
    id: string;
    name: string;
    email: string;
    avatar?: string;
    role: string;
  } | null;
}

export interface Workbook {
  _id: string;
  ownerId: string;
  name: string;
  sheets: Sheet[];
  activeSheetId: string;
  namedRanges: NamedRange[];
  version: number;
  createdAt: string;
  updatedAt: string;
  _access?: WorkbookAccess;
  _isShared?: boolean;
}

export interface WorkbookSummary {
  _id: string;
  name: string;
  ownerId: string;
  activeSheetId: string;
  sheets: Array<{ id: string; name: string }>;
  createdAt: string;
  updatedAt: string;
  _access?: WorkbookAccess;
  _isShared?: boolean;
}
