import { z } from 'zod';

export const SaveAutomationSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  trigger: z.string().min(1).max(80),
  condition: z.record(z.unknown()).default({}),
  action: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});
export type SaveAutomationDto = z.infer<typeof SaveAutomationSchema>;

export const UpdateAutomationSchema = SaveAutomationSchema.partial();
export type UpdateAutomationDto = z.infer<typeof UpdateAutomationSchema>;

export const FireSchema = z.object({
  trigger: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
});
export type FireDto = z.infer<typeof FireSchema>;
