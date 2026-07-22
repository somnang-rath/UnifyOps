'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Hash, Lock, Plus, Send } from 'lucide-react';
import { Avatar, SearchInput, Spinner } from '@prism/ui';
import { useChannels } from '@/hooks/use-chat';
import { cn } from '@/lib/utils';
import type { ChannelView } from '@/schemas/chat';
import { NewChannelModal } from './new-channel-modal';

export function ChannelList({
  workspaceId,
  workspaceSlug,
  activeChannelId,
}: {
  workspaceId: string | null;
  workspaceSlug: string;
  activeChannelId: string | null;
}) {
  const { data: channels, isLoading } = useChannels(workspaceId, 'mine');
  const [q, setQ] = useState('');
  const [newOpen, setNewOpen] = useState(false);

  const { rooms, dms } = useMemo(() => {
    const list = (channels ?? []).filter((c) =>
      c.name.toLowerCase().includes(q.toLowerCase()),
    );
    return {
      rooms: list.filter((c) => c.kind === 'channel'),
      dms: list.filter((c) => c.kind === 'dm'),
    };
  }, [channels, q]);

  return (
    <>
      <div className="p-3 flex items-center gap-2">
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="flex-1 !min-w-0"
        />
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          title="New channel"
          className="w-8 h-8 flex-shrink-0 rounded-sm border border-border flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-hover"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <>
            <Section
              title="Channels"
              icon={<Hash className="w-3 h-3" />}
              items={rooms}
              workspaceSlug={workspaceSlug}
              activeChannelId={activeChannelId}
            />
            <Section
              title="Direct Messages"
              icon={<Send className="w-3 h-3" />}
              items={dms}
              workspaceSlug={workspaceSlug}
              activeChannelId={activeChannelId}
            />
            {rooms.length === 0 && dms.length === 0 && (
              <p className="px-2 py-6 text-[12px] text-text-muted text-center">
                No conversations yet.
              </p>
            )}
          </>
        )}
      </div>

      {newOpen && workspaceId && (
        <NewChannelModal
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          onClose={() => setNewOpen(false)}
        />
      )}
    </>
  );
}

function Section({
  title,
  icon,
  items,
  workspaceSlug,
  activeChannelId,
}: {
  title: string;
  icon: React.ReactNode;
  items: ChannelView[];
  workspaceSlug: string;
  activeChannelId: string | null;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="px-2 pt-2 pb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.08em] text-text-muted">
        {icon}
        {title}
      </div>
      {items.map((c) => (
        <ChannelRow
          key={c._id}
          channel={c}
          href={`/${workspaceSlug}/chat/${c._id}`}
          active={c._id === activeChannelId}
        />
      ))}
    </div>
  );
}

function ChannelRow({
  channel,
  href,
  active,
}: {
  channel: ChannelView;
  href: string;
  active: boolean;
}) {
  const unread = channel.unreadCount;
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 rounded-sm text-[13px]',
        'hover:bg-bg-hover transition-colors',
        active ? 'bg-accent-50 text-accent-700 dark:bg-[rgba(99,102,241,.15)]' : 'text-text-sub',
        unread > 0 && !active && 'text-text font-medium',
      )}
    >
      {channel.kind === 'dm' ? (
        <Avatar
          name={channel.peer?.name ?? channel.name}
          src={channel.peer?.avatar}
          size="xs"
        />
      ) : channel.visibility === 'private' ? (
        <Lock className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
      ) : (
        <Hash className="w-3.5 h-3.5 flex-shrink-0 text-text-muted" />
      )}
      <span className="flex-1 truncate">{channel.name || 'Untitled'}</span>
      {channel.telegram?.active && (
        <span
          title="Mirrored to Telegram"
          className="text-[10px] text-[#229ED9] font-bold"
        >
          TG
        </span>
      )}
      {unread > 0 && (
        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold px-1">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
