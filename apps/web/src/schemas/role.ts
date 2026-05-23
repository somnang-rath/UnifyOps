export interface Role {
  _id: string;
  key: string;
  name: string;
  color: string;
  builtin: boolean;
}

export const ROLE_COLORS = [
  'indigo',
  'violet',
  'sky',
  'emerald',
  'amber',
  'rose',
  'cyan',
  'slate',
] as const;
export type RoleColor = (typeof ROLE_COLORS)[number];

/** Tailwind utility classes for a role pill, keyed by role color. */
export const ROLE_PILL: Record<string, string> = {
  indigo: 'bg-grad text-white',
  violet: 'bg-[rgba(139,92,246,.12)] text-violet',
  sky: 'bg-[rgba(56,189,248,.12)] text-sky',
  emerald: 'bg-[rgba(16,185,129,.12)] text-green',
  amber: 'bg-[rgba(245,158,11,.12)] text-amber',
  rose: 'bg-[rgba(244,63,94,.12)] text-rose',
  cyan: 'bg-[rgba(6,182,212,.12)] text-cyan',
  slate: 'bg-bg-hover text-text-sub',
};
