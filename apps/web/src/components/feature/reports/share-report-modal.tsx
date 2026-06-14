'use client';

import { useState } from 'react';
import {
  Globe, Lock, Search, Shield, Trash2, User, Users, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGrantMutations } from '@/hooks/use-reports';
import { useUsers } from '@/hooks/use-users';
import { useAuthStore } from '@/stores/auth-store';
import type { ReportTemplate, ReportGrant } from '@/schemas/report';
import type { DirectoryUser } from '@/schemas/user';
import { cn } from '@/lib/utils';

// Built-in team roles that can be targeted by a role grant
const TEAM_ROLES = [
  { value: 'admin',     label: 'Admins',     color: '#ef4444' },
  { value: 'cpo',       label: 'CPOs',       color: '#f97316' },
  { value: 'dev',       label: 'Developers', color: '#6366f1' },
  { value: 'marketing', label: 'Marketing',  color: '#ec4899' },
  { value: 'sales',     label: 'Sales',      color: '#0891b2' },
  { value: 'user',      label: 'All Users',  color: '#6b7280' },
];

interface Props {
  template: ReportTemplate;
  onClose: () => void;
}

export function ShareReportModal({ template, onClose }: Props) {
  const me = useAuthStore((s) => s.user);
  const { data: allUsers = [] } = useUsers();
  const { add, remove } = useGrantMutations(template._id);

  const [tab, setTab]       = useState<'user' | 'team'>('user');
  const [search, setSearch] = useState('');
  const [level, setLevel]   = useState<'view' | 'edit'>('view');

  const grants = template.grants ?? [];

  // Users already granted (by userId)
  const grantedUserIds = new Set(grants.filter((g) => g.userId).map((g) => g.userId));
  // Roles already granted
  const grantedRoles = new Set(grants.filter((g) => g.role).map((g) => g.role));

  // Filter eligible users: not self, not already granted
  const eligible: DirectoryUser[] = allUsers.filter((u) => {
    if (u._id === me?.id) return false;
    if (grantedUserIds.has(u._id)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const handleAddUser = (userId: string) => {
    add.mutate({ userId, level });
    setSearch('');
  };

  const handleAddRole = (role: string) => {
    add.mutate({ role, level });
  };

  const handleRemove = (grantId: string) => {
    remove.mutate(grantId);
  };

  // Resolve display info for a grant
  const resolveGrant = (g: ReportGrant) => {
    if (g.userId) {
      const u = allUsers.find((u) => u._id === g.userId);
      return {
        label: u?.name ?? 'Unknown user',
        sub:   u?.email ?? g.userId,
        icon:  <User className="w-3.5 h-3.5" />,
        color: '#6366f1',
      };
    }
    const role = TEAM_ROLES.find((r) => r.value === g.role);
    return {
      label: role?.label ?? g.role ?? 'Unknown role',
      sub:   'Team',
      icon:  <Users className="w-3.5 h-3.5" />,
      color: role?.color ?? '#6b7280',
    };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-modal-in">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center">
              <Globe className="w-4 h-4 text-accent-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Share Report</h2>
              <p className="text-xs text-text-muted truncate max-w-[220px]">{template.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">

          {/* Tab: User vs Team */}
          <div className="flex gap-1 bg-bg-subtle rounded-lg p-1">
            {(['user', 'team'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setSearch(''); }}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                  tab === t
                    ? 'bg-bg-card shadow-sm text-text border border-border'
                    : 'text-text-muted hover:text-text',
                )}
              >
                {t === 'user' ? <User className="w-3.5 h-3.5" /> : <Users className="w-3.5 h-3.5" />}
                {t === 'user' ? 'Add user' : 'Add team'}
              </button>
            ))}
          </div>

          {/* Access level selector */}
          <div className="flex gap-2">
            {(['view', 'edit'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all',
                  level === l
                    ? 'border-accent-400 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-300'
                    : 'border-border bg-bg-subtle text-text-muted hover:bg-bg-hover',
                )}
              >
                {l === 'view'
                  ? <><Lock className="w-3.5 h-3.5" /> View only</>
                  : <><Shield className="w-3.5 h-3.5" /> Can edit</>}
              </button>
            ))}
          </div>

          {/* User search */}
          {tab === 'user' && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border bg-bg-input focus:outline-none focus:ring-2 focus:ring-accent-400/40 focus:border-accent-400"
              />
              {search && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-bg-card border border-border rounded-xl shadow-lg py-1 z-20 max-h-48 overflow-y-auto">
                  {eligible.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-text-muted">No users found</p>
                  ) : (
                    eligible.map((u) => (
                      <button
                        key={u._id}
                        onClick={() => handleAddUser(u._id)}
                        disabled={add.isPending}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-bg-hover text-left disabled:opacity-50"
                      >
                        {u.avatar
                          ? <img src={u.avatar} className="w-7 h-7 rounded-full object-cover flex-shrink-0" alt="" />
                          : (
                            <div className="w-7 h-7 rounded-full bg-accent-100 flex items-center justify-center flex-shrink-0 text-accent-700 text-xs font-bold">
                              {u.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate">{u.name}</p>
                          <p className="text-[11px] text-text-muted truncate">{u.email}</p>
                        </div>
                        <span className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded bg-bg-subtle text-text-muted capitalize flex-shrink-0">
                          {u.role}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {/* Team role picker */}
          {tab === 'team' && (
            <div className="grid grid-cols-2 gap-2">
              {TEAM_ROLES.map((r) => {
                const alreadyGranted = grantedRoles.has(r.value);
                return (
                  <button
                    key={r.value}
                    onClick={() => !alreadyGranted && handleAddRole(r.value)}
                    disabled={alreadyGranted || add.isPending}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-xs font-medium transition-all',
                      alreadyGranted
                        ? 'border-border bg-bg-subtle text-text-muted cursor-not-allowed opacity-50'
                        : 'border-border bg-bg-card hover:bg-bg-hover hover:border-accent-300',
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: r.color }}
                    />
                    {r.label}
                    {alreadyGranted && (
                      <span className="ml-auto text-[10px] text-green-600 dark:text-green-400 font-bold">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Current grants list */}
          {grants.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                People with access
              </p>
              <div className="space-y-1">
                {grants.map((g) => {
                  const info = resolveGrant(g);
                  return (
                    <div
                      key={g.id}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-bg-subtle border border-border"
                    >
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs"
                        style={{ background: info.color }}
                      >
                        {info.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{info.label}</p>
                        <p className="text-[11px] text-text-muted truncate">{info.sub}</p>
                      </div>
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0',
                        g.level === 'edit'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800'
                          : 'bg-bg-card text-text-muted border border-border',
                      )}>
                        {g.level === 'edit' ? 'Edit' : 'View'}
                      </span>
                      <button
                        onClick={() => handleRemove(g.id)}
                        disabled={remove.isPending}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-text-muted hover:text-red-500 transition-colors disabled:opacity-40 flex-shrink-0"
                        title="Revoke access"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border flex items-center justify-between">
          <p className="text-[11px] text-text-muted">
            {grants.length > 0
              ? `${grants.length} ${grants.length === 1 ? 'person has' : 'people have'} access`
              : 'Only you have access'}
          </p>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
