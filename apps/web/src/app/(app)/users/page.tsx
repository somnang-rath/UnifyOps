'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  Edit2,
  Lock,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { Input, InputWithIcon } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import {
  useAdminUserMutations,
  useInviteUser,
  useResendInvite,
  useUsers,
  type InviteResult,
} from '@/hooks/use-users';
import { useRoleMutations, useRoles } from '@/hooks/use-roles';
import { useDebounce } from '@/hooks/use-debounce';
import { useAuthStore } from '@/stores/auth-store';
import { useFormat } from '@prism/i18n';
import { cn } from '@/lib/utils';
import { ROLE_COLORS, ROLE_PILL, type Role } from '@/schemas/role';
import type { DirectoryUser } from '@/schemas/user';

/* ── helpers ─────────────────────────────────────────────── */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

/* ── InviteModal ─────────────────────────────────────────── */

function InviteModal({
  open,
  onClose,
  roleOptions,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  roleOptions: { value: string; label: string }[];
  onInvited: (result: InviteResult) => void;
}) {
  const invite = useInviteUser();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState(roleOptions[0]?.value ?? 'member');

  function reset() {
    setName('');
    setEmail('');
    setRole(roleOptions[0]?.value ?? 'member');
  }

  function close() {
    reset();
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    invite.mutate(
      { name: name.trim(), email: email.trim(), role },
      {
        onSuccess: (data) => {
          close();
          onInvited(data);
        },
      },
    );
  }

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 3 &&
    !invite.isPending;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite member"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit as any}
            disabled={!canSubmit}
          >
            <UserPlus className="w-3.5 h-3.5" />
            {invite.isPending ? 'Inviting…' : 'Send invite'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Full name">
          <Input
            placeholder="Jane Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Email">
          <Input
            type="email"
            placeholder="jane@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>

        <Field label="Role">
          <Select value={role} onValueChange={setRole} options={roleOptions} />
        </Field>

        <p className="text-[12px] text-text-muted leading-[1.6] -mt-1">
          A strong password will be generated automatically and emailed to the
          member. You will also see it once after inviting.
        </p>
      </form>
    </Modal>
  );
}

/* ── CredentialsModal ────────────────────────────────────── */

function CredentialsModal({
  result,
  onClose,
}: {
  result: InviteResult | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!result}
      onClose={onClose}
      title="Member invited"
      size="sm"
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      {result && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[rgba(16,185,129,.08)] border border-[rgba(16,185,129,.25)]">
            <Check className="w-4 h-4 text-green mt-0.5 shrink-0" />
            <p className="text-[13px] text-text leading-[1.6]">
              <strong>{result.user.name}</strong> has been invited successfully.
              A welcome email with their login credentials has been sent to{' '}
              <strong>{result.user.email}</strong>.
            </p>
          </div>
          <p className="text-[12px] text-text-muted leading-[1.5]">
            The member should check their inbox and sign in using the credentials
            in the email. Ask them to change their password after the first sign-in.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ── EditUserModal ───────────────────────────────────────── */

function EditUserModal({
  user,
  onClose,
  roleOptions,
}: {
  user: DirectoryUser | null;
  onClose: () => void;
  roleOptions: { value: string; label: string }[];
}) {
  const adminMutations = useAdminUserMutations();
  const [name, setName] = useState(user?.name ?? '');
  const [role, setRole] = useState(user?.role ?? '');

  // sync when user changes
  const prevId = useRef<string | null>(null);
  if (user && user._id !== prevId.current) {
    prevId.current = user._id;
    setName(user.name);
    setRole(user.role);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !name.trim()) return;
    const patch: { name?: string; role?: string } = {};
    if (name.trim() !== user.name) patch.name = name.trim();
    if (role !== user.role) patch.role = role;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    adminMutations.update.mutate(
      { id: user._id, patch },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal
      open={!!user}
      onClose={onClose}
      title="Edit member"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit as any}
            disabled={!name.trim() || adminMutations.update.isPending}
          >
            {adminMutations.update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Full name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        <Field label="Email">
          <Input
            className="opacity-60 cursor-not-allowed"
            value={user?.email ?? ''}
            readOnly
            tabIndex={-1}
          />
          <p className="text-[11px] text-text-muted -mt-1">
            Email cannot be changed by admin
          </p>
        </Field>

        <Field label="Role">
          <Select value={role} onValueChange={setRole} options={roleOptions} />
        </Field>
      </form>
    </Modal>
  );
}

/* ── ActionsDropdown ─────────────────────────────────────── */

function ActionsDropdown({
  user,
  isMe,
  onEdit,
  onBlock,
  onDelete,
  onResendInvite,
}: {
  user: DirectoryUser;
  isMe: boolean;
  onEdit: () => void;
  onBlock: () => void;
  onDelete: () => void;
  onResendInvite: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleOpen() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = 160; // approximate height of the dropdown
    const spaceBelow = window.innerHeight - rect.bottom;
    const right = window.innerWidth - rect.right;
    if (spaceBelow < menuHeight) {
      setPos({ bottom: window.innerHeight - rect.top + 4, right });
    } else {
      setPos({ top: rect.bottom + 4, right });
    }
    setOpen((v) => !v);
  }

  const btn =
    'flex items-center gap-2.5 w-full px-3 py-2 text-[12.5px] text-text-sub ' +
    'hover:bg-bg-hover hover:text-text transition-colors text-left rounded-sm';

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={isMe}
        onClick={handleOpen}
        className={cn(
          'w-7 h-7 rounded-sm flex items-center justify-center text-text-muted',
          'hover:bg-bg-hover hover:text-text transition-colors',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        title="Actions"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, right: pos.right, zIndex: 9999 }}
          className={cn(
            'w-44 rounded-lg border border-border bg-bg-card shadow-lg p-1',
            'animate-fade-in',
          )}
        >
          <button
            type="button"
            className={btn}
            onClick={() => { setOpen(false); onEdit(); }}
          >
            <Edit2 className="w-3.5 h-3.5 text-text-muted" />
            Edit member
          </button>

          {user.invitePending && (
            <button
              type="button"
              className={btn}
              onClick={() => { setOpen(false); onResendInvite(); }}
            >
              <Mail className="w-3.5 h-3.5 text-text-muted" />
              Resend invite
            </button>
          )}

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            className={btn}
            onClick={() => { setOpen(false); onBlock(); }}
          >
            <Ban className="w-3.5 h-3.5 text-text-muted" />
            {user.blocked ? 'Unblock' : 'Block'}
          </button>

          <button
            type="button"
            className={cn(btn, 'text-red hover:text-red hover:bg-[rgba(239,68,68,.08)]')}
            onClick={() => { setOpen(false); onDelete(); }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete member
          </button>
        </div>
      )}
    </div>
  );
}

/* ── RolesModal ──────────────────────────────────────────── */

function RolesModal({
  open,
  onClose,
  roles,
  users,
}: {
  open: boolean;
  onClose: () => void;
  roles: Role[];
  users: DirectoryUser[];
}) {
  const { create, remove } = useRoleMutations();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('indigo');

  const usageByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users) m.set(u.role, (m.get(u.role) ?? 0) + 1);
    return m;
  }, [users]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim() || !name.trim()) return;
    create.mutate(
      { key: key.trim().toLowerCase(), name: name.trim(), color },
      {
        onSuccess: () => {
          setKey('');
          setName('');
          setColor('indigo');
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage roles" size="md">
      <form
        onSubmit={submit}
        className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end"
      >
        <Field label="Key">
          <Input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="designer"
            pattern="[a-z][a-z0-9_-]*"
          />
        </Field>
        <Field label="Display name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Designer"
          />
        </Field>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          <Plus className="w-3.5 h-3.5" />
          Add
        </Button>
        <div className="col-span-3 flex items-center gap-1.5 -mt-1">
          <span className="text-[11px] text-text-muted mr-1">Color:</span>
          {ROLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={c}
              className={cn(
                'w-5 h-5 rounded-full border-[1.5px] transition-all',
                ROLE_PILL[c],
                color === c
                  ? 'border-text scale-110'
                  : 'border-transparent hover:scale-105',
              )}
            />
          ))}
        </div>
      </form>

      <div className="border-t border-border pt-4 mt-2">
        <h3 className="text-[11px] font-semibold text-text-muted uppercase tracking-[.06em] mb-2">
          Existing roles
        </h3>
        <ul className="flex flex-col divide-y divide-border border border-border rounded-sm bg-bg-card">
          {roles.map((r) => {
            const inUse = usageByRole.get(r.key) ?? 0;
            return (
              <li
                key={r.key}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      'inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize',
                      ROLE_PILL[r.color] ?? ROLE_PILL.slate,
                    )}
                  >
                    {r.name}
                  </span>
                  <span className="text-[12px] text-text-muted truncate">
                    {r.key}
                    {r.builtin && ' · built-in'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {inUse} {inUse === 1 ? 'user' : 'users'}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={r.builtin || inUse > 0 || remove.isPending}
                    onClick={() => remove.mutate(r.key)}
                    aria-label={`Delete role ${r.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-text-muted mt-2 leading-[1.6]">
          Built-in roles can't be deleted. A custom role can only be removed
          once no users are assigned to it.
        </p>
      </div>
    </Modal>
  );
}

/* ── Th / Td ─────────────────────────────────────────────── */

function Th({
  children,
  align,
}: React.PropsWithChildren<{ align?: 'left' | 'right' }>) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-left',
        align === 'right' && 'text-right',
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className,
}: React.PropsWithChildren<{ align?: 'left' | 'right'; className?: string }>) {
  return (
    <td
      className={cn('px-4 py-3', align === 'right' && 'text-right', className)}
    >
      {children}
    </td>
  );
}

/* ── Page ────────────────────────────────────────────────── */

export default function UsersPage() {
  const f = useFormat();
  const me = useAuthStore((s) => s.user);
  const { data: users = [], isLoading } = useUsers();
  const { data: roles = [] } = useRoles();
  const adminUsers = useAdminUserMutations();
  const resendInvite = useResendInvite();

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 220);

  // modal states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [editUser, setEditUser] = useState<DirectoryUser | null>(null);
  const [confirmDel, setConfirmDel] = useState<DirectoryUser | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<{
    user: DirectoryUser;
    block: boolean;
  } | null>(null);

  const list = useMemo(() => {
    const needle = debouncedQ.toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle),
    );
  }, [users, debouncedQ]);

  const roleByKey = useMemo(
    () => new Map(roles.map((r) => [r.key, r])),
    [roles],
  );

  const roleOptions = useMemo(
    () => roles.map((r) => ({ value: r.key, label: r.name })),
    [roles],
  );

  // NOTE: this guard must stay below every hook call (rules-of-hooks).
  if (me?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-24 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-subtle border border-border mb-4">
          <Lock className="w-5 h-5 text-text-muted" />
        </div>
        <h1 className="text-[20px] font-bold tracking-[-.02em] mb-1.5">
          Not authorized
        </h1>
        <p className="text-[13px] text-text-muted leading-[1.6]">
          The People directory is only available to workspace admins.
        </p>
      </div>
    );
  }

  function rolePill(roleKey: string) {
    const role = roleByKey.get(roleKey);
    const cls = ROLE_PILL[role?.color ?? 'slate'] ?? ROLE_PILL.slate;
    return (
      <span
        className={cn(
          'inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize',
          cls,
        )}
      >
        {role?.name ?? roleKey}
      </span>
    );
  }

  const activeCount = users.filter((u) => !u.blocked).length;
  const blockedCount = users.filter((u) => u.blocked).length;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-.02em] leading-[1.2]">
            People
          </h1>
          <p className="text-[13px] text-text-muted mt-1">
            {activeCount} active
            {blockedCount > 0 && ` · ${blockedCount} blocked`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <InputWithIcon
            icon={<Search />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
            className="w-[240px]"
          />

          <Button
            variant="outline"
            onClick={() => setRolesOpen(true)}
            className="gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Manage roles
          </Button>

          <Button
            variant="primary"
            onClick={() => setInviteOpen(true)}
            className="gap-1.5"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Invite member
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-bg-subtle border-b border-border text-text-muted">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                  Loading…
                </td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-text-muted">
                  {debouncedQ ? 'No people match your search' : 'No members yet — invite someone!'}
                </td>
              </tr>
            ) : (
              list.map((u) => {
                const isMe = u._id === me?.id || u._id === (me as any)?._id;
                return (
                  <tr
                    key={u._id}
                    className={cn(
                      'border-b border-border last:border-b-0 hover:bg-bg-hover transition-colors',
                      u.blocked && 'opacity-60',
                    )}
                  >
                    <Td>
                      <span className="flex items-center gap-2.5">
                        <Avatar name={u.name} src={u.avatar} size="md" />
                        <strong className="text-[13px] font-semibold">
                          {u.name}
                          {isMe && (
                            <span className="ml-1.5 text-[11px] font-normal text-text-muted">
                              (you)
                            </span>
                          )}
                        </strong>
                      </span>
                    </Td>

                    <Td className="text-text-sub">{u.email}</Td>

                    <Td>
                      {isMe || u.role === 'admin' ? (
                        rolePill(u.role)
                      ) : (
                        <Select
                          inline
                          value={u.role}
                          options={roleOptions}
                          onValueChange={(role) =>
                            adminUsers.update.mutate({
                              id: u._id,
                              patch: { role },
                            })
                          }
                          disabled={adminUsers.update.isPending}
                        />
                      )}
                    </Td>

                    <Td>
                      {u.invitePending ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[rgba(99,102,241,.12)] text-accent">
                          <Mail className="w-3 h-3" />
                          Invite pending
                        </span>
                      ) : u.blocked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[rgba(244,63,94,.12)] text-rose">
                          <Ban className="w-3 h-3" />
                          Blocked
                        </span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[rgba(16,185,129,.12)] text-green">
                          Active
                        </span>
                      )}
                    </Td>

                    <Td className="text-text-muted">{f.date(u.createdAt)}</Td>

                    <Td align="right">
                      <ActionsDropdown
                        user={u}
                        isMe={isMe}
                        onEdit={() => setEditUser(u)}
                        onBlock={() => setConfirmBlock({ user: u, block: !u.blocked })}
                        onDelete={() => setConfirmDel(u)}
                        onResendInvite={() => resendInvite.mutate(u._id)}
                      />
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        roleOptions={roleOptions}
        onInvited={(result) => setInviteResult(result)}
      />

      <CredentialsModal
        result={inviteResult}
        onClose={() => setInviteResult(null)}
      />

      <EditUserModal
        user={editUser}
        onClose={() => setEditUser(null)}
        roleOptions={roleOptions}
      />

      <RolesModal
        open={rolesOpen}
        onClose={() => setRolesOpen(false)}
        roles={roles}
        users={users}
      />

      <Confirm
        open={!!confirmBlock}
        title={confirmBlock?.block ? 'Block user?' : 'Unblock user?'}
        body={
          confirmBlock?.block
            ? `${confirmBlock.user.name} will be signed out immediately and unable to log back in until unblocked.`
            : `${confirmBlock?.user.name} will be able to sign in again.`
        }
        danger={confirmBlock?.block}
        onClose={() => setConfirmBlock(null)}
        onConfirm={() => {
          if (!confirmBlock) return;
          adminUsers.update.mutate({
            id: confirmBlock.user._id,
            patch: { blocked: confirmBlock.block },
          });
        }}
      />

      <Confirm
        open={!!confirmDel}
        title="Delete member?"
        body={`Permanently remove ${confirmDel?.name}. This cannot be undone.`}
        danger
        onClose={() => setConfirmDel(null)}
        onConfirm={() => {
          if (confirmDel) adminUsers.remove.mutate(confirmDel._id);
        }}
      />
    </>
  );
}
