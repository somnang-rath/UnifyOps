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
 * `ENG-142`. The rest arrive in their own slices (§14) — each one adds
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
