'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Spinner } from '@prism/ui';
import { useMessages, useMarkRead } from '@/hooks/use-chat';
import { useChatStore } from '@/stores/chat-store';
import { MessageItem } from './message-item';
import { TypingIndicator } from './typing-indicator';
import type { MessageView } from '@/schemas/chat';

/**
 * Who a message is *from*, for grouping. Not `author._id`: a message relayed
 * from Telegram has no Prism author at all, so comparing that id alone silently
 * treats every unlinked sender — and the assistant's own reply — as one speaker,
 * hiding the name row that says otherwise.
 */
function speakerKey(m: MessageView): string {
  return [
    m.kind,
    m.source,
    m.author?._id ?? m.externalAuthor?.name ?? 'unknown',
  ].join(':');
}

export function MessageList({ channelId }: { channelId: string }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(channelId);
  const markRead = useMarkRead(channelId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSeenId = useRef<string | null>(null);
  const typing = useChatStore((s) => s.typing[channelId]);

  const messages = useMemo<MessageView[]>(
    () => (data?.pages ?? []).flatMap((p) => p.items),
    [data],
  );
  const latest = messages[messages.length - 1];

  // Auto-scroll to the newest message and mark the channel read — but only when a
  // genuinely new message lands, so paging older history upward doesn't yank the
  // view back down.
  useEffect(() => {
    if (!latest || latest._id === lastSeenId.current) return;
    const isFirstLoad = lastSeenId.current === null;
    lastSeenId.current = latest._id;
    bottomRef.current?.scrollIntoView({
      behavior: isFirstLoad ? 'auto' : 'smooth',
    });
    if (!latest._id.startsWith('optimistic-')) markRead.mutate(latest._id);
    // markRead is stable enough; exclude to avoid re-running on each mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest]);

  // Load older messages when the user scrolls to the top.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !hasNextPage || isFetchingNextPage) return;
    if (el.scrollTop < 80) {
      const prevHeight = el.scrollHeight;
      fetchNextPage().then(() => {
        // Keep the viewport anchored where the user was after prepending.
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop =
              scrollRef.current.scrollHeight - prevHeight;
          }
        });
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const typingUsers = Object.values(typing ?? {}).filter(
    (u) => Date.now() - u.at < 5000,
  );

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="flex-1 overflow-y-auto px-4 py-3 flex flex-col"
    >
      {isFetchingNextPage && (
        <div className="flex justify-center py-2">
          <Spinner />
        </div>
      )}
      {!hasNextPage && messages.length > 0 && (
        <p className="text-center text-[12px] text-text-muted py-3">
          Beginning of the conversation
        </p>
      )}
      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-[13px] text-text-muted">
          No messages yet — say hello.
        </div>
      )}
      {messages.map((m, i) => (
        <MessageItem
          key={m._id}
          message={m}
          channelId={channelId}
          // Group consecutive messages from the same author.
          grouped={
            i > 0 &&
            speakerKey(messages[i - 1]) === speakerKey(m) &&
            new Date(m.createdAt).getTime() -
              new Date(messages[i - 1].createdAt).getTime() <
              5 * 60_000
          }
        />
      ))}
      {typingUsers.length > 0 && <TypingIndicator users={typingUsers} />}
      <div ref={bottomRef} />
    </div>
  );
}
