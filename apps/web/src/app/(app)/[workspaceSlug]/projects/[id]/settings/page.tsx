'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Search, Trash2, UserPlus, X } from 'lucide-react';
import { useProject, useProjectMutations } from '@/hooks/use-projects';
import { usePublicInstance } from '@/hooks/use-public-instance';
import { useWorkspaceHref } from '@/hooks/use-workspaces';
import { useUsers } from '@/hooks/use-users';
import { useAuthStore } from '@/stores/auth-store';
import { CoverImagePicker } from '@/components/feature/cover/cover-image-picker';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Confirm } from '@/components/ui/confirm';
import { fmtDate } from '@/lib/format';

export default function ProjectSettingsPage() {
  const id = useParams<{ id: string }>().id;
  const router = useRouter();
  const ws = useWorkspaceHref();
  const me = useAuthStore((s) => s.user);

  const { data: project } = useProject(id);
  const { data: users = [] } = useUsers();
  const { update, remove } = useProjectMutations();

  const { data: instance } = usePublicInstance();

  const [addOpen, setAddOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

  if (!project) return null;

  const userMap = new Map(users.map((u) => [u._id, u]));
  const isOwner = !!me && (me.id === project.ownerId || me.role === 'admin');
  // Cover controls mirror the actual PATCH /projects/:id guard — owner-only
  // (no member or role-admin bypass in projects.service.update), stricter
  // than `isOwner` above so we never offer an action that would 403.
  const canEditCover = !!me && me.id === project.ownerId;
  const unsplashEnabled = instance?.config.UNSPLASH_ENABLED === true;
  const setCover = (coverImage: string | null) =>
    update.mutate({ id: project._id, body: { coverImage } });

  const toEmails = (ids: string[]) =>
    ids.map((mid) => userMap.get(mid)?.email).filter(Boolean) as string[];

  const addMember = async (userId: string) => {
    const u = userMap.get(userId);
    if (!u) return;
    const emails = toEmails(project.members);
    if (emails.includes(u.email)) return;
    setSaving(true);
    try {
      await update.mutateAsync({
        id: project._id,
        body: { memberEmails: [...emails, u.email] },
      });
    } finally {
      setSaving(false);
      setAddOpen(false);
      setMemberSearch('');
    }
  };

  const removeMember = async (memberId: string) => {
    const u = userMap.get(memberId);
    if (!u) return;
    const emails = toEmails(project.members).filter((e) => e !== u.email);
    setSaving(true);
    try {
      await update.mutateAsync({
        id: project._id,
        body: { memberEmails: emails },
      });
    } finally {
      setSaving(false);
    }
  };

  const memberSet = new Set([project.ownerId, ...project.members]);
  const suggestions = users.filter((u) => {
    if (memberSet.has(u._id)) return false;
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  });

  const owner = userMap.get(project.ownerId);

  return (
    <div className="max-w-[720px] flex flex-col gap-6">
      {/* Cover image (ADR 0010) — always-visible path to the picker (§5.3).
          Unsplash off + no cover ⇒ whole section hidden; Unsplash off + cover
          ⇒ Remove only (removal never gates on Unsplash). */}
      {canEditCover && (unsplashEnabled || project.coverImage) && (
        <section>
          <h2 className="text-[15px] font-semibold mb-3">Cover image</h2>
          <div className="flex items-center gap-4 bg-bg-card border border-border rounded-lg px-4 py-3.5">
            {project.coverImage ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked cover URL (ADR 0010 §3) */}
                <img
                  src={project.coverImage}
                  alt=""
                  draggable={false}
                  className="h-16 aspect-[4/1] rounded-md object-cover border border-border"
                />
                <div className="flex items-center gap-2 ml-auto">
                  {unsplashEnabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setCoverPickerOpen(true)}
                    >
                      Change
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCover(null)}
                  >
                    Remove
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-text-muted">No cover image.</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => setCoverPickerOpen(true)}
                >
                  Add cover
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      {/* Members */}
      <section>
        <h2 className="text-[15px] font-semibold mb-3">Members</h2>
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          {owner && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Avatar name={owner.name} src={owner.avatar} size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold">{owner.name}</div>
                <div className="text-[11px] text-text-muted">{owner.email}</div>
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                Owner
              </span>
            </div>
          )}

          {project.members
            .filter((mid) => mid !== project.ownerId)
            .map((memberId) => {
              const u = userMap.get(memberId);
              if (!u) return null;
              return (
                <div
                  key={memberId}
                  className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0"
                >
                  <Avatar name={u.name} src={u.avatar} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold">{u.name}</div>
                    <div className="text-[11px] text-text-muted">{u.email}</div>
                  </div>
                  <span className="text-[11px] text-text-muted capitalize mr-2">
                    {u.role}
                  </span>
                  {isOwner && (
                    <button
                      onClick={() => removeMember(memberId)}
                      disabled={saving}
                      title="Remove member"
                      className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:bg-red/10 hover:text-red transition-colors disabled:opacity-40"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}

          {isOwner && (
            <div className="border-t border-border">
              {addOpen ? (
                <div className="p-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-3 bg-bg-input border border-border rounded-sm focus-within:border-accent transition-colors">
                    <Search className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                    <input
                      autoFocus
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="flex-1 py-2 text-[13px] bg-transparent outline-none placeholder:text-text-muted"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setAddOpen(false);
                          setMemberSearch('');
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        setAddOpen(false);
                        setMemberSearch('');
                      }}
                      className="text-text-muted hover:text-text"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {suggestions.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-text-muted">
                      {memberSearch.trim()
                        ? 'No users match'
                        : 'All workspace users are already members'}
                    </p>
                  ) : (
                    <ul className="max-h-48 overflow-y-auto">
                      {suggestions.map((u) => (
                        <li key={u._id}>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => addMember(u._id)}
                            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-sm text-left hover:bg-bg-hover transition-colors disabled:opacity-40"
                          >
                            <Avatar name={u.name} src={u.avatar} size="sm" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-medium truncate">
                                {u.name}
                              </div>
                              <div className="text-[11px] text-text-muted truncate">
                                {u.email}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setAddOpen(true)}
                  className="w-full flex items-center gap-2 px-4 py-3 text-[13px] text-text-muted hover:text-text hover:bg-bg-hover transition-colors"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add member
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-[11px] text-text-muted mt-2">
          Created {fmtDate(project.createdAt)}
        </p>
      </section>

      {/* Danger zone */}
      {isOwner && (
        <section>
          <h2 className="text-[15px] font-semibold mb-3 text-red">
            Danger zone
          </h2>
          <div className="flex items-center justify-between gap-4 bg-bg-card border border-red/30 rounded-lg px-4 py-3.5">
            <div>
              <div className="text-[13px] font-semibold">Delete project</div>
              <div className="text-[12px] text-text-muted">
                Permanently delete this project and all of its work items.
              </div>
            </div>
            <Button variant="outline" onClick={() => setDeleting(true)}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </section>
      )}

      <Confirm
        open={deleting}
        title="Delete project"
        body={
          <>
            This will permanently delete <strong>{project.name}</strong> and all
            of its work items.
          </>
        }
        danger
        onConfirm={() =>
          remove.mutate(project._id, {
            onSuccess: () => router.push(ws('/projects')),
          })
        }
        onClose={() => setDeleting(false)}
      />

      <CoverImagePicker
        open={coverPickerOpen}
        onClose={() => setCoverPickerOpen(false)}
        value={project.coverImage ?? null}
        onSelect={(url) => setCover(url)}
      />
    </div>
  );
}
