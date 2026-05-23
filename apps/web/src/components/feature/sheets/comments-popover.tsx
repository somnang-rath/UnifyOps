'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Send, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';
import { useUsers } from '@/hooks/use-users';
import { useCommentMutations } from '@/hooks/use-workbook-comments';
import type {
  CommentReply,
  WorkbookComment,
} from '@/hooks/use-workbook-comments';

interface Props {
  workbookId: string;
  sheetId: string;
  cellRef: string;
  comments: WorkbookComment[]; // already filtered to this cell
  x: number;
  y: number;
  onClose: () => void;
}

export function CommentsPopover({
  workbookId,
  sheetId,
  cellRef,
  comments,
  x,
  y,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const me = useAuthStore((s) => s.user);
  const { data: users = [] } = useUsers();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const { create, update, remove, reply } = useCommentMutations(workbookId);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const W = 320;
  const H = 380;
  const left = Math.min(x, window.innerWidth - W - 8);
  const top = Math.min(y, window.innerHeight - H - 8);

  const submitNew = () => {
    const body = draft.trim();
    if (!body) return;
    create.mutate(
      { sheetId, cellRef, body },
      {
        onSuccess: () => setDraft(''),
      },
    );
  };

  const submitReply = (cid: string) => {
    const body = replyDraft.trim();
    if (!body) return;
    reply.mutate(
      { cid, body },
      {
        onSuccess: () => {
          setReplyDraft('');
          setReplyTo(null);
        },
      },
    );
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white border border-border rounded-md shadow-xl flex flex-col text-[13px]"
      style={{ left, top, width: W, maxHeight: H }}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-border">
        <div className="font-medium text-[12px] text-text-muted">
          Comments on {cellRef}
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 inline-flex items-center justify-center rounded hover:bg-bg-hover"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {comments.length === 0 ? (
          <div className="px-3 py-4 text-center text-[12px] text-text-muted">
            No comments yet.
          </div>
        ) : (
          comments.map((c) => {
            const author = userMap.get(c.authorId);
            const myId = me ? String(me._id ?? me.id) : '';
            const isMine = !!myId && myId === c.authorId;
            return (
              <div
                key={c._id}
                className={cn(
                  'px-3 py-2 border-b border-border',
                  c.resolved && 'opacity-55',
                )}
              >
                <div className="flex items-start gap-2">
                  <Avatar name={author?.name ?? '?'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      <span className="font-medium text-text">
                        {author?.name ?? 'Unknown'}
                      </span>
                      <span>·</span>
                      <span>{formatTime(c.createdAt)}</span>
                      {c.resolved && (
                        <span className="ml-auto text-[10px] uppercase tracking-wider px-1.5 py-px bg-bg-subtle rounded">
                          Resolved
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap break-words mt-0.5">
                      {c.body}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <button
                        onClick={() =>
                          update.mutate({
                            cid: c._id,
                            body: { resolved: !c.resolved },
                          })
                        }
                        className="text-[11px] text-text-muted hover:text-text inline-flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        {c.resolved ? 'Reopen' : 'Resolve'}
                      </button>
                      <span className="text-text-muted">·</span>
                      <button
                        onClick={() =>
                          setReplyTo((cur) => (cur === c._id ? null : c._id))
                        }
                        className="text-[11px] text-text-muted hover:text-text"
                      >
                        Reply
                      </button>
                      {isMine && (
                        <>
                          <span className="text-text-muted">·</span>
                          <button
                            onClick={() => remove.mutate(c._id)}
                            className="text-[11px] text-text-muted hover:text-red inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {c.replies.length > 0 && (
                  <div className="mt-2 ml-7 space-y-2 border-l-2 border-border pl-2">
                    {c.replies.map((rep: CommentReply) => {
                      const repAuthor = userMap.get(rep.authorId);
                      return (
                        <div key={rep.id}>
                          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            <span className="font-medium text-text">
                              {repAuthor?.name ?? 'Unknown'}
                            </span>
                            <span>·</span>
                            <span>{formatTime(rep.createdAt)}</span>
                          </div>
                          <div className="whitespace-pre-wrap break-words text-[12px]">
                            {rep.body}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {replyTo === c._id && (
                  <div className="mt-2 ml-7 flex items-end gap-1">
                    <textarea
                      value={replyDraft}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      placeholder="Write a reply…"
                      rows={2}
                      className="flex-1 text-[12px] px-2 py-1 border border-border rounded outline-none focus:border-accent resize-none"
                    />
                    <button
                      onClick={() => submitReply(c._id)}
                      disabled={!replyDraft.trim()}
                      className="w-7 h-7 inline-flex items-center justify-center rounded bg-accent text-white disabled:opacity-40"
                      title="Send"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="px-3 py-2 border-t border-border flex items-end gap-1">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          className="flex-1 text-[12px] px-2 py-1 border border-border rounded outline-none focus:border-accent resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submitNew();
            }
          }}
        />
        <button
          onClick={submitNew}
          disabled={!draft.trim()}
          className="w-8 h-8 inline-flex items-center justify-center rounded bg-accent text-white disabled:opacity-40"
          title="Send (Ctrl+Enter)"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div className="w-6 h-6 rounded-full bg-grad text-white text-[11px] font-semibold flex items-center justify-center shrink-0">
      {initial}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}
