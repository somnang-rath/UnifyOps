'use client';
import { useParams } from 'next/navigation';
import { useChannel, useJoinChannel } from '@/hooks/use-chat';
import { useCurrentWorkspace } from '@/hooks/use-workspaces';
import { ErrorState, Spinner } from '@prism/ui';
import { ChannelHeader } from '../_components/channel-header';
import { MessageList } from '../_components/message-list';
import { MessageComposer } from '../_components/message-composer';

export default function ChannelPage() {
  const channelId = useParams<{ channelId: string }>().channelId;
  const { data: channel, isLoading, isError } = useChannel(channelId);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (isError || !channel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <ErrorState message="Channel not found" />
      </div>
    );
  }

  return (
    <>
      <ChannelHeader channel={channel} />
      <MessageList channelId={channelId} />
      {channel.isMember ? (
        <MessageComposer channelId={channelId} />
      ) : (
        <JoinBar channelId={channelId} />
      )}
    </>
  );
}

/** A public channel can be read without joining; posting needs a join. */
function JoinBar({ channelId }: { channelId: string }) {
  const { current } = useCurrentWorkspace();
  const join = useJoinChannel(current?.id ?? '');
  return (
    <div className="border-t border-border p-3 flex items-center justify-center gap-3 text-[13px] text-text-muted">
      <span>You&apos;re previewing this channel.</span>
      <button
        type="button"
        onClick={() => join.mutate(channelId)}
        disabled={join.isPending}
        className="px-3 py-1.5 rounded-sm bg-accent text-white text-[12px] font-medium hover:opacity-90 disabled:opacity-60"
      >
        Join channel
      </button>
    </div>
  );
}
