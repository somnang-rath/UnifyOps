'use client';
import { useState } from 'react';
import { Hash, Lock, Send, Users } from 'lucide-react';
import { TelegramLinkPanel } from './telegram-link-panel';
import type { ChannelView } from '@/schemas/chat';

export function ChannelHeader({ channel }: { channel: ChannelView }) {
  const [tgOpen, setTgOpen] = useState(false);
  const isDm = channel.kind === 'dm';

  return (
    <div className="flex items-center gap-3 px-4 h-[52px] border-b border-border flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        {isDm ? (
          <Send className="w-4 h-4 text-text-muted" />
        ) : channel.visibility === 'private' ? (
          <Lock className="w-4 h-4 text-text-muted" />
        ) : (
          <Hash className="w-4 h-4 text-text-muted" />
        )}
        <span className="text-[14px] font-semibold truncate">
          {channel.name || 'Untitled'}
        </span>
        {channel.topic && (
          <>
            <span className="text-text-muted">·</span>
            <span className="text-[12px] text-text-muted truncate">
              {channel.topic}
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {!isDm && (
          <span className="flex items-center gap-1 text-[12px] text-text-muted">
            <Users className="w-3.5 h-3.5" />
            {channel.memberIds.length}
          </span>
        )}
        {channel.telegram?.active && (
          <span
            title={`Mirrored to ${channel.telegram.chatTitle || 'Telegram'}`}
            className="text-[10px] font-bold text-[#229ED9] px-1.5 py-0.5 rounded bg-[#229ED9]/10"
          >
            Telegram
          </span>
        )}
        {!isDm && (
          <button
            type="button"
            onClick={() => setTgOpen(true)}
            className="text-[12px] text-text-muted hover:text-text px-2 py-1 rounded-sm hover:bg-bg-hover"
          >
            {channel.telegram?.linked ? 'Telegram settings' : 'Connect Telegram'}
          </button>
        )}
      </div>

      {tgOpen && (
        <TelegramLinkPanel channel={channel} onClose={() => setTgOpen(false)} />
      )}
    </div>
  );
}
