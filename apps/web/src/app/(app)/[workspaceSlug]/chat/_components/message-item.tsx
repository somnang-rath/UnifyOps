'use client';
import { useState } from 'react';
import { Pencil, SmilePlus, Trash2, X, Check } from 'lucide-react';
import { Avatar } from '@prism/ui';
import {
  useDeleteMessage,
  useEditMessage,
  useToggleReaction,
} from '@/hooks/use-chat';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { useFormat } from '@prism/i18n';
import type { MessageView } from '@/schemas/chat';

const QUICK_EMOJI = ['👍', '❤️', '😄', '🎉', '👀'];

export function MessageItem({
  message,
  channelId,
  grouped,
}: {
  message: MessageView;
  channelId: string;
  grouped: boolean;
}) {
  const f = useFormat();
  const meId = useAuthStore((s) => s.user?.id);
  const edit = useEditMessage(channelId);
  const del = useDeleteMessage(channelId);
  const react = useToggleReaction(channelId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.body);
  const [showEmoji, setShowEmoji] = useState(false);

  const isMine =
    message.source === 'prism' && !!meId && message.author?._id === meId;
  const displayName =
    message.author?.name ?? message.externalAuthor?.name ?? 'Unknown';
  const isTelegram = message.source === 'telegram';
  // The assistant's `@prism` reply, mirrored back from the bridged group. It is
  // authored by no Prism user, so the badge is what says it wasn't a person.
  const isAssistant = message.kind === 'system';

  if (message.deleted) {
    return (
      <div className={cn('px-2 py-0.5 text-[13px] text-text-muted italic', grouped ? 'pl-12' : 'pl-12')}>
        This message was deleted
      </div>
    );
  }

  return (
    <div className={cn('group relative flex gap-3 px-2 rounded-sm hover:bg-bg-hover', grouped ? 'py-0.5' : 'pt-3 pb-0.5')}>
      <div className="w-9 flex-shrink-0">
        {!grouped && (
          <Avatar name={displayName} src={message.author?.avatar} size="md" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-semibold">{displayName}</span>
            {isAssistant && (
              <span className="text-[9px] font-bold text-accent px-1 rounded bg-accent/10">
                assistant
              </span>
            )}
            {isTelegram && (
              <span className="text-[9px] font-bold text-[#229ED9] px-1 rounded bg-[#229ED9]/10">
                via Telegram
              </span>
            )}
            <span className="text-[11px] text-text-muted">
              {f.time(message.createdAt)}
            </span>
          </div>
        )}

        {editing ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter' && draft.trim()) {
                  edit.mutate({ messageId: message._id, body: draft.trim() });
                  setEditing(false);
                }
              }}
              className="flex-1 bg-bg-input border border-border rounded-sm px-2 py-1 text-[13px] outline-none focus:border-accent"
            />
            <button onClick={() => { edit.mutate({ messageId: message._id, body: draft.trim() }); setEditing(false); }} className="text-text-muted hover:text-accent">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => setEditing(false)} className="text-text-muted hover:text-text">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="text-[13px] text-text-sub whitespace-pre-wrap break-words">
            {message.body}
            {message.editedAt && (
              <span className="text-[10px] text-text-muted ml-1">(edited)</span>
            )}
          </div>
        )}

        {message.reactions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {message.reactions.map((r) => (
              <button
                key={r.emoji}
                onClick={() => react.mutate({ messageId: message._id, emoji: r.emoji })}
                className={cn(
                  'flex items-center gap-1 px-1.5 h-5 rounded-full border text-[11px]',
                  meId && r.userIds.includes(meId)
                    ? 'border-accent bg-accent-50 dark:bg-[rgba(99,102,241,.15)]'
                    : 'border-border bg-bg-subtle hover:border-border-strong',
                )}
              >
                <span>{r.emoji}</span>
                <span className="text-text-muted">{r.userIds.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hover actions */}
      <div className="absolute right-2 -top-3 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 bg-bg-card border border-border rounded-sm shadow-sm">
        <div className="relative">
          <button
            onClick={() => setShowEmoji((v) => !v)}
            title="React"
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text"
          >
            <SmilePlus className="w-3.5 h-3.5" />
          </button>
          {showEmoji && (
            <div className="absolute right-0 top-8 z-10 flex gap-1 bg-bg-card border border-border rounded-sm p-1 shadow-md">
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    react.mutate({ messageId: message._id, emoji: e });
                    setShowEmoji(false);
                  }}
                  className="w-7 h-7 rounded hover:bg-bg-hover text-[15px]"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        {isMine && (
          <>
            <button
              onClick={() => { setDraft(message.body); setEditing(true); }}
              title="Edit"
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => del.mutate(message._id)}
              title="Delete"
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-red-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
