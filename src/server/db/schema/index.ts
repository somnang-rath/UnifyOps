/**
 * The schema drizzle-kit reads (see drizzle.config.ts).
 *
 * Slice 1 is the tenancy foundation: the tenant root, membership, one child
 * table with two tenant parents to prove the composite-key invariant, and the
 * audit log. Projects, work items and the rest arrive in their own slices
 * (§14) — each one adds `...tenantPolicies()` and gets FORCE RLS from the
 * hardening step, or it does not ship.
 */
export * from './_shared';
export * from './user';
export * from './workspace';
export * from './team';
export * from './audit';
