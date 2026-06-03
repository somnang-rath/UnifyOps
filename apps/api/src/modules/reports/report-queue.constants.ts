export const REPORT_QUEUE = 'report-dispatch';
export const REPORT_DISPATCH_JOB = 'dispatch';

/** Payload stored in Redis for each queued report run. */
export interface ReportDispatchJobData {
  runId: string;
  templateId: string;
  frequency: string;
}
