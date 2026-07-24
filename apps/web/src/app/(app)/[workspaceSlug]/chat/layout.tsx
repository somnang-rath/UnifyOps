'use client';
import { type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useWorkspaceBySlug } from '@/hooks/use-workspaces';
import { useChatSocket } from '@/hooks/use-chat-socket';
import { ChannelList } from './_components/channel-list';

/**
 * Two-pane chat shell: channel list on the left, the active channel on the right.
 * Mounts the single chat socket here so it survives channel navigation, and joins
 * the active channel room based on the /chat/[channelId] segment.
 */
export default function ChatLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ workspaceSlug: string; channelId?: string }>();
  const { data: workspace } = useWorkspaceBySlug(params.workspaceSlug ?? null);
  useChatSocket(params.channelId ?? null);

  return (
    <div className="flex h-[calc(100vh-var(--topbar-h,52px))] overflow-hidden">
      <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-bg-subtle/40">
        <ChannelList
          workspaceId={workspace?.id ?? null}
          workspaceSlug={params.workspaceSlug}
          activeChannelId={params.channelId ?? null}
        />
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
    </div>
  );
}
