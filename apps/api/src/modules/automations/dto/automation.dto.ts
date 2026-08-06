import { z } from 'zod';
import { ConditionSchema } from '../condition';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const SaveAutomationSchema = z.object({
  /**
   * Required: the rule's tenant (ADR 0003). A rule only ever fires on events in
   * its own workspace, so a rule without one could not fire at all.
   */
  workspaceId: objectId,
  name: z.string().min(1).max(120).trim(),
  trigger: z.string().min(1).max(80),
  /**
   * Validated against the engine's own grammar (`../condition.ts`) so a rule
   * that could never match is a 400 the author can fix, not a rule that sits
   * enabled and silently does nothing. `{}` = always.
   */
  condition: ConditionSchema.default({}),
  action: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
export type SaveAutomationDto = z.infer<typeof SaveAutomationSchema>;

/**
 * `workspaceId` is omitted deliberately — moving a rule between tenants is not
 * an edit, it is a re-create, and allowing it here would let a member of two
 * workspaces relocate a rule out from under the other one.
 */
export const UpdateAutomationSchema = SaveAutomationSchema.partial().omit({
  workspaceId: true,
});
export type UpdateAutomationDto = z.infer<typeof UpdateAutomationSchema>;

export const ListAutomationsQuerySchema = z.object({
  /** Narrowing-only (ADR 0011 §2b): omit to list every workspace you belong to. */
  workspaceId: objectId.optional(),
});
export type ListAutomationsQuery = z.infer<typeof ListAutomationsQuerySchema>;
