/**
 * Issue templates + CSV bulk import (Phase 8 —
 * docs/plan/specs/templates-csv-import.md §1). Consumed by apps/api and
 * apps/web. Both features are web-only on the frontend side.
 *
 * Shapes mirror the API wire format (templates module + POST /issues/import):
 * template defaults are all optional, template todos carry no stored id
 * (ids are minted client-side when a template is applied), and the author
 * field is `createdBy`.
 */

/** A checklist item inside a template. `id` is minted on apply, not stored. */
export interface TemplateTodo {
  id?: string;
  text: string;
  done: boolean;
}

/** Defaults a template pre-fills into a new work item. */
export interface IssueTemplateDefaults {
  desc?: string;
  /** ISSUE_TYPES member. */
  type?: string;
  /** ISSUE_PRIORITIES member. */
  priority?: string;
  labels?: string[];
  /** Checklist items — templates define items, never completion. */
  todos?: TemplateTodo[];
}

export interface IssueTemplate {
  _id: string;
  /** "Bug report", "Design task" */
  name: string;
  workspaceId: string;
  /** null ⇒ workspace-scoped (visible in every project of the workspace). */
  projectId: string | null;
  /** Author — the API returns `createdBy`; `ownerId` kept as the spec alias. */
  createdBy?: string;
  ownerId?: string;
  defaults: IssueTemplateDefaults;
  /** Sort order within a project/workspace's template list. */
  position?: number;
  updatedAt: string;
}

/**
 * One CSV data row, post client normalization (labels split on ';'/',',
 * dates ISO-ified, unknown statuses/priorities coerced client-side). Rows
 * without a title are client-rejected before POST.
 */
export interface ImportRow {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  labels?: string[];
  /** ISO yyyy-mm-dd after client normalization. */
  dueDate?: string;
  /** Server resolves to a workspace member; unresolved → created unassigned. */
  assigneeEmail?: string;
}

/**
 * One skipped row in the import result. `row` is the 1-based index within
 * the posted rows array (CSV data rows, header excluded).
 */
export interface ImportSkippedRow {
  row: number;
  reason: string;
}

/** Response of POST /issues/import. */
export interface ImportResult {
  created: number;
  skipped: ImportSkippedRow[];
}
