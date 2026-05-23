'use client';
import { useMemo, useState } from 'react';
import { Search, Shield, UserPlus, Users, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Select } from '@/components/ui/select';
import { Confirm } from '@/components/ui/confirm';
import { useFolderGrants, useFileMutations } from '@/hooks/use-files';
import { useUsers } from '@/hooks/use-users';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import type { Folder, GrantLevel, GrantRole } from '@/schemas/file';

const LEVEL_OPTIONS: { value: GrantLevel; label: string; hint: string }[] = [
  { value: 'read', label: 'Read', hint: 'View & download files' },
  { value: 'upload', label: 'Upload', hint: 'Read + upload own files' },
  { value: 'edit', label: 'Edit', hint: 'Manage any file in folder' },
  { value: 'none', label: 'No access', hint: 'Block on this subfolder' },
];

const levelSelectOptions = LEVEL_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

const ROLE_OPTIONS: { value: GrantRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admins', hint: 'Workspace administrators' },
  { value: 'cpo', label: 'Product', hint: 'CPO & product team' },
  { value: 'marketing', label: 'Marketing', hint: 'Marketing team' },
  { value: 'sales', label: 'Sales', hint: 'Sales team' },
  { value: 'dev', label: 'Engineering', hint: 'Developers' },
];

const ROLE_LABEL: Record<GrantRole, string> = Object.fromEntries(
  ROLE_OPTIONS.map((r) => [r.value, r.label]),
) as Record<GrantRole, string>;

export function ShareFolderModal({
  folder,
  onClose,
}: {
  folder: Folder | null;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: grants = [] } = useFolderGrants(folder?._id ?? null);
  const { data: users = [] } = useUsers();
  const { setGrant, removeGrant } = useFileMutations();

  const [picker, setPicker] = useState<null | 'people' | 'roles'>(null);
  const [search, setSearch] = useState('');
  const [revoking, setRevoking] = useState<
    | { kind: 'user'; userId: string; name: string }
    | { kind: 'role'; role: GrantRole; label: string }
    | null
  >(null);

  const grantedUserIds = useMemo(
    () =>
      new Set(grants.filter((g) => g.userId).map((g) => g.userId as string)),
    [grants],
  );
  const grantedRoles = useMemo(
    () => new Set(grants.filter((g) => g.role).map((g) => g.role as GrantRole)),
    [grants],
  );

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => u.id !== me?.id && !grantedUserIds.has(u.id))
      .filter((u) =>
        !q
          ? true
          : u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [users, search, grantedUserIds, me?.id]);

  const roleCandidates = useMemo(
    () => ROLE_OPTIONS.filter((r) => !grantedRoles.has(r.value)),
    [grantedRoles],
  );

  const isOpen = !!folder;
  const close = () => {
    setPicker(null);
    setSearch('');
    onClose();
  };

  return (
    <>
      <Modal
        open={isOpen}
        onClose={close}
        size="md"
        title={folder ? `Share “${folder.name}”` : 'Share'}
        footer={
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        }
      >
        {!folder ? null : (
          <div className="space-y-4">
            <p className="text-[12.5px] text-text-muted leading-relaxed">
              People and roles you add can access this folder and any
              subfolders that don't override the permission.
            </p>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-[.06em] text-text-muted">
                  Access
                </span>
                <div className="flex gap-1.5">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPicker((p) => (p === 'people' ? null : 'people'));
                      setSearch('');
                    }}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    {picker === 'people' ? 'Close' : 'Add people'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      setPicker((p) => (p === 'roles' ? null : 'roles'))
                    }
                  >
                    <Shield className="w-3.5 h-3.5" />
                    {picker === 'roles' ? 'Close' : 'Add role'}
                  </Button>
                </div>
              </div>

              {picker === 'people' && (
                <div className="mb-2.5 border border-border rounded-md bg-bg-card overflow-hidden">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                    <Search className="w-3.5 h-3.5 text-text-muted" />
                    <input
                      autoFocus
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search name or email…"
                      className="flex-1 bg-transparent border-0 outline-none text-[13px] placeholder:text-text-muted"
                    />
                  </div>
                  <div className="max-h-[200px] overflow-y-auto py-1">
                    {candidates.length === 0 ? (
                      <div className="px-3 py-3 text-[12px] text-text-muted">
                        No matching users.
                      </div>
                    ) : (
                      candidates.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setGrant.mutate({
                              folderId: folder._id,
                              target: { userId: u.id },
                              level: 'read',
                            });
                            setPicker(null);
                            setSearch('');
                          }}
                          className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-bg-hover transition-colors"
                        >
                          <Avatar name={u.name} size="sm" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium truncate">
                              {u.name}
                            </span>
                            <span className="block text-[11px] text-text-muted truncate">
                              {u.email}
                            </span>
                          </span>
                          <span className="text-[10.5px] uppercase tracking-wider text-text-muted">
                            {u.role}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {picker === 'roles' && (
                <div className="mb-2.5 border border-border rounded-md bg-bg-card overflow-hidden">
                  <div className="px-3 py-2 border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                    Share with everyone in a role
                  </div>
                  <div className="max-h-[260px] overflow-y-auto py-1">
                    {roleCandidates.length === 0 ? (
                      <div className="px-3 py-3 text-[12px] text-text-muted">
                        All roles already have access.
                      </div>
                    ) : (
                      roleCandidates.map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => {
                            setGrant.mutate({
                              folderId: folder._id,
                              target: { role: r.value },
                              level: 'read',
                            });
                            setPicker(null);
                          }}
                          className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-bg-hover transition-colors"
                        >
                          <span className="w-7 h-7 rounded-full bg-[color:color-mix(in_srgb,var(--a)_18%,var(--bg-subtle))] text-accent flex items-center justify-center">
                            <Shield className="w-3.5 h-3.5" />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium truncate">
                              {r.label}
                            </span>
                            <span className="block text-[11px] text-text-muted truncate">
                              {r.hint}
                            </span>
                          </span>
                          <span className="text-[10.5px] uppercase tracking-wider text-text-muted">
                            Role
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="border border-border rounded-md divide-y divide-border bg-bg-card">
                <Row
                  avatar={<Avatar name={me?.name ?? 'You'} size="sm" />}
                  name={`${me?.name ?? 'You'} (owner)`}
                  sub={me?.email ?? ''}
                  trailing={
                    <span className="text-[11px] text-text-muted px-2 py-1">
                      Owner
                    </span>
                  }
                />
                {grants.length === 0 ? (
                  <div className="px-3 py-3 text-[12.5px] text-text-muted">
                    Only you have access. Add people or roles above.
                  </div>
                ) : (
                  grants.map((g) => {
                    const isRole = !!g.role;
                    const key = isRole
                      ? `role:${g.role}`
                      : `user:${g.userId}`;
                    const name = isRole
                      ? ROLE_LABEL[g.role as GrantRole] ??
                        (g.role as string)
                      : g.user?.name ?? 'Removed user';
                    const sub = isRole
                      ? 'Everyone with this role'
                      : g.user?.email ?? '';
                    const avatar = isRole ? (
                      <span className="w-8 h-8 rounded-full bg-[color:color-mix(in_srgb,var(--a)_18%,var(--bg-subtle))] text-accent flex items-center justify-center flex-shrink-0">
                        <Users className="w-4 h-4" />
                      </span>
                    ) : (
                      <Avatar
                        name={g.user?.name ?? '?'}
                        size="sm"
                      />
                    );
                    return (
                      <Row
                        key={key}
                        avatar={avatar}
                        name={name}
                        sub={sub}
                        muted={!isRole && !g.user}
                        trailing={
                          <div className="flex items-center gap-1.5">
                            <Select<GrantLevel>
                              inline
                              value={g.level}
                              onValueChange={(v) =>
                                setGrant.mutate({
                                  folderId: folder._id,
                                  target: isRole
                                    ? { role: g.role as GrantRole }
                                    : { userId: g.userId as string },
                                  level: v,
                                })
                              }
                              options={levelSelectOptions}
                            />
                            <button
                              type="button"
                              title="Remove access"
                              onClick={() =>
                                setRevoking(
                                  isRole
                                    ? {
                                        kind: 'role',
                                        role: g.role as GrantRole,
                                        label:
                                          ROLE_LABEL[g.role as GrantRole] ??
                                          (g.role as string),
                                      }
                                    : {
                                        kind: 'user',
                                        userId: g.userId as string,
                                        name:
                                          g.user?.name ?? 'this user',
                                      },
                                )
                              }
                              className="w-7 h-7 rounded-sm flex items-center justify-center text-text-muted hover:bg-bg-subtle hover:text-red"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        }
                      />
                    );
                  })
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {LEVEL_OPTIONS.map((l) => (
                  <div
                    key={l.value}
                    className="flex items-baseline gap-1.5 text-[11.5px]"
                  >
                    <span className="font-semibold text-text">{l.label}</span>
                    <span className="text-text-muted">— {l.hint}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Confirm
        open={!!revoking}
        title="Remove access"
        body={
          revoking?.kind === 'role' ? (
            <>
              Remove the <strong>{revoking.label}</strong> role's access to
              this folder?
            </>
          ) : (
            <>
              Remove <strong>{revoking?.name}</strong>&apos;s access to this
              folder?
            </>
          )
        }
        danger
        onConfirm={() => {
          if (revoking && folder)
            removeGrant.mutate({
              folderId: folder._id,
              target:
                revoking.kind === 'role'
                  ? revoking.role
                  : revoking.userId,
            });
        }}
        onClose={() => setRevoking(null)}
      />
    </>
  );
}

function Row({
  avatar,
  name,
  sub,
  trailing,
  muted,
}: {
  avatar: React.ReactNode;
  name: string;
  sub: string;
  trailing: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-3 py-2',
        muted && 'opacity-60',
      )}
    >
      {avatar}
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium truncate">{name}</span>
        {sub && (
          <span className="block text-[11px] text-text-muted truncate">
            {sub}
          </span>
        )}
      </span>
      {trailing}
    </div>
  );
}
