export type ErrorSource = 'frontend' | 'backend';
export type ErrorLogType = 'error' | 'debug' | 'warning' | 'info';
export type DeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown';

export interface ErrorLog {
  _id: string;
  source: ErrorSource;
  logType: ErrorLogType;
  statusCode?: number;
  errorTitle: string;
  errorMessage: string;
  stackTrace?: string;
  endpointUrl?: string;
  pageRoute?: string;
  userId?: string;
  userEmail?: string;
  browser?: string;
  operatingSystem?: string;
  deviceType?: DeviceType;
  applicationVersion?: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  resolvedStatus: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorLogListResult {
  items: ErrorLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ErrorLogStats {
  totalErrors: number;
  totalDebug: number;
  totalWarning: number;
  frontendErrors: number;
  backendErrors: number;
  resolved: number;
  unresolved: number;
  recentErrors: Pick<ErrorLog, '_id' | 'errorTitle' | 'createdAt' | 'source' | 'statusCode'>[];
}

export interface ErrorLogQuery {
  page?: number;
  limit?: number;
  source?: ErrorSource;
  logType?: ErrorLogType;
  statusCode?: number;
  resolved?: 'true' | 'false';
  userId?: string;
  userEmail?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface CreateErrorLogPayload {
  source: ErrorSource;
  logType: ErrorLogType;
  statusCode?: number;
  errorTitle: string;
  errorMessage: string;
  stackTrace?: string;
  endpointUrl?: string;
  pageRoute?: string;
  userEmail?: string;
  browser?: string;
  operatingSystem?: string;
  deviceType?: DeviceType;
  applicationVersion?: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
}
