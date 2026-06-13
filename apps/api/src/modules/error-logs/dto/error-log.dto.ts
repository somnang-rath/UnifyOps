import { z } from 'zod';

const SENSITIVE_KEYS = /password|token|secret|key|auth|credential|cookie|session/i;

function sanitizePayload(
  obj: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== 'object') return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.test(k)) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizePayload(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const CreateErrorLogSchema = z.object({
  source: z.enum(['frontend', 'backend']),
  logType: z.enum(['error', 'debug', 'warning', 'info']),
  statusCode: z.number().int().min(100).max(599).optional(),
  errorTitle: z.string().min(1).max(500),
  errorMessage: z.string().min(1).max(10000),
  stackTrace: z.string().max(50000).optional(),
  endpointUrl: z.string().max(2000).optional(),
  pageRoute: z.string().max(2000).optional(),
  userEmail: z.string().email().optional().or(z.literal('')),
  browser: z.string().max(200).optional(),
  operatingSystem: z.string().max(200).optional(),
  deviceType: z.enum(['desktop', 'mobile', 'tablet', 'unknown']).optional(),
  applicationVersion: z.string().max(50).optional(),
  requestPayload: z.record(z.unknown()).optional().transform(sanitizePayload),
  responsePayload: z.record(z.unknown()).optional().transform(sanitizePayload),
});
export type CreateErrorLogDto = z.infer<typeof CreateErrorLogSchema>;

export const QueryErrorLogsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  source: z.enum(['frontend', 'backend']).optional(),
  logType: z.enum(['error', 'debug', 'warning', 'info']).optional(),
  statusCode: z.coerce.number().int().optional(),
  resolved: z.enum(['true', 'false']).optional(),
  userId: z.string().optional(),
  userEmail: z.string().optional(),
  search: z.string().max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});
export type QueryErrorLogsDto = z.infer<typeof QueryErrorLogsSchema>;

export const BulkIdsSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});
export type BulkIdsDto = z.infer<typeof BulkIdsSchema>;

export const CleanupSettingsSchema = z.object({
  retentionDays: z.number().int().min(1).max(365),
});
export type CleanupSettingsDto = z.infer<typeof CleanupSettingsSchema>;
