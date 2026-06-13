export const ALL_BACKUP_SCOPES = [
  'projects',
  'issues',
  'notes',
  'noteFolders',
  'wiki',
  'workbooks',
  'reports',
  'automations',
  'mrs',
] as const;

export type BackupScope = (typeof ALL_BACKUP_SCOPES)[number];

export const BACKUP_SCOPE_LABELS: Record<BackupScope, string> = {
  projects:    'Projects',
  issues:      'Issues & Tasks',
  notes:       'Notes',
  noteFolders: 'Note Folders',
  wiki:        'Wiki Pages',
  workbooks:   'Spreadsheets',
  reports:     'Reports',
  automations: 'Automations',
  mrs:         'Approvals / MRs',
};

export type BackupFileStatus    = 'generating' | 'ready' | 'failed';
export type BackupTriggeredBy   = 'manual' | 'schedule';
export type BackupFrequency     = 'daily' | 'weekly' | 'monthly';
export type BackupPasswordMode  = 'none' | 'custom';

export interface BackupFile {
  _id:         string;
  fileName:    string;
  size:        number;
  scopes:      BackupScope[];
  triggeredBy: BackupTriggeredBy;
  status:      BackupFileStatus;
  encrypted:   boolean;
  expiresAt:   string;
  createdAt:   string;
  error?:      string;
}

export interface BackupScheduleSettings {
  _id:          string;
  enabled:      boolean;
  frequency:    BackupFrequency;
  time:         string;  // "HH:MM"
  dayOfWeek:    number;  // 0-6
  dayOfMonth:   number;  // 1-31
  timezone:     string;
  scopes:       BackupScope[];
  passwordMode: BackupPasswordMode;
  fileName:     string;
  nextRunAt?:   string;
  lastRunAt?:   string;
  createdAt:    string;
  updatedAt:    string;
}

export interface ExportOptions {
  scopes:    BackupScope[];
  password?: string | null;
  fileName:  string;
}

export type ImportStrategy = 'merge' | 'replace';

export interface ImportOptions {
  strategy:  ImportStrategy;
  scopes?:   BackupScope[];
  password?: string | null;
}

export interface ImportResult {
  inserted: Partial<Record<BackupScope, number>>;
  skipped:  Partial<Record<BackupScope, number>>;
}

export interface BackupMeta {
  version:    string;
  app:        string;
  exportedAt: string;
  exportedBy: string;
  fileName:   string;
  encrypted:  boolean;
  scopes:     BackupScope[];
  iv?:        string;
  salt?:      string;
}

export interface BackupFilePreview {
  meta:      BackupMeta;
  encrypted: boolean;
}
