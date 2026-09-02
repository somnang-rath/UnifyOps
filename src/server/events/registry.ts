import type { DomainEvent, EventOf, EventType } from './types';

/**
 * How an audited event becomes an audit row (§18-11).
 *
 * `audit: false` is an explicit decision, not an omission — an ordinary title
 * edit does not belong in a workspace-scoped, append-only, never-translated
 * log, and saying so here is what keeps the log readable.
 *
 * `data` exists so the payload written to the log is chosen rather than
 * inherited. Events carry whatever their caller needed; an audit row should
 * carry what an owner reading it six months later needs, and nothing they
 * should not see.
 */
export type AuditSpec<T extends EventType> = {
  subjectType: string;
  subject: (event: EventOf<T>) => string | null;
  data?: (event: EventOf<T>) => Record<string, unknown>;
};

export type RegistryEntry<T extends EventType> = {
  audit: AuditSpec<T> | false;
  /**
   * The activity projector lands in slice 7 (§8, §14). It is a second field on
   * this same entry for the same reason `audit` is one: exhaustive over the
   * event union, so a new event type cannot be added without deciding how it
   * renders in the feed.
   */
};

/**
 * Exhaustive over `DomainEvent` by construction. Adding a member to the union
 * without adding it here does not compile.
 */
export const eventRegistry: { [T in EventType]: RegistryEntry<T> } = {
  'workspace.created': {
    audit: {
      subjectType: 'workspace',
      subject: (e) => e.workspaceId,
      data: (e) => ({ slug: e.slug, name: e.name }),
    },
  },
  'workspace.renamed': {
    audit: {
      subjectType: 'workspace',
      subject: (e) => e.workspaceId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'workspace_member.added': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ userId: e.userId, role: e.role }),
    },
  },
  'workspace_member.role_changed': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ from: e.from, to: e.to }),
    },
  },
  'workspace_member.removed': {
    audit: {
      subjectType: 'workspace_member',
      subject: (e) => e.memberId,
      data: (e) => ({ userId: e.userId }),
    },
  },
  'team.created': {
    audit: {
      subjectType: 'team',
      subject: (e) => e.teamId,
      data: (e) => ({ slug: e.slug, name: e.name }),
    },
  },
  // Team composition changes are ordinary collaboration, visible in the team's
  // own screens. They are activity, not audit.
  'team.member_added': { audit: false },
  'team.member_removed': { audit: false },
};

export type AuditDraft = {
  action: EventType;
  subjectType: string;
  subjectId: string | null;
  data: Record<string, unknown>;
};

/** The audit row an event produces, or null when the registry says it is not auditable. */
export function auditRowFor(event: DomainEvent): AuditDraft | null {
  // The union-to-entry correspondence is exact by construction above, but
  // TypeScript cannot narrow `event` and `entry` together through an index
  // signature, so this is the one place the correlation is asserted.
  const entry = eventRegistry[event.type] as RegistryEntry<EventType>;
  const spec = entry.audit as AuditSpec<EventType> | false;
  if (!spec) return null;

  return {
    action: event.type,
    subjectType: spec.subjectType,
    subjectId: spec.subject(event),
    data: spec.data?.(event) ?? {},
  };
}
