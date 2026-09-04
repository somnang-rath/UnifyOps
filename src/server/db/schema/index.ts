/**
 * The schema drizzle-kit reads (see drizzle.config.ts).
 *
 * Slice 1 is the tenancy foundation: the tenant root, membership, one child
 * table with two tenant parents to prove the composite-key invariant, and the
 * audit log. Slice 3 adds the auth tables — which are pre-tenancy by nature and
 * protected by grant rather than by policy — and invitations, which are
 * ordinary tenant data with one extra identity-role SELECT so a token can be
 * exchanged for the workspace it names. Slice 4 adds projects, project
 * membership and workflow states. Slice 5 adds work items, their assignment and
 * label joins, the workspace's labels, and the per-project counter behind
 * `ENG-142`. Slice 7 adds `activity`, the second sink on the event registry
 * beside `audit_record`. Slice 8 adds comments, the mentions in them, and the
 * attachments that hang off either an item or a comment. Slice 9 adds the
 * transactional outbox, the inbox it feeds, per-user notification preferences,
 * and the holiday calendar §7.8's evening digest has to consult before it sends
 * anything. Slice 10 adds custom fields — the per-project definitions, their
 * options, and the typed value rows §9 insists are real columns rather than
 * JSONB. Slice 11 adds `cycle`, and the one nullable column on `work_item`
 * that puts an item in one. Slice 12 adds `saved_view`, the one row behind
 * §4's "saved views" and §12's per-view table column widths. Slice 15 adds
 * `workspace_notification_default` and four columns on `workspace` — week
 * start, default language, logo key and accent — which is the whole of §6-1 and
 * §6-7 that was not already a column, and completes §6. The rest arrive in their own slices (§14) — each one adds
 * `...tenantPolicies()` and gets FORCE RLS from the hardening step, or it does
 * not ship.
 */
export * from './_shared';
export * from './user';
export * from './workspace';
export * from './team';
export * from './project';
export * from './audit';
export * from './auth';
export * from './invitation';
export * from './work-item';
export * from './activity';
export * from './comment';
export * from './attachment';
export * from './notification';
export * from './custom-field';
export * from './cycle';
export * from './saved-view';
