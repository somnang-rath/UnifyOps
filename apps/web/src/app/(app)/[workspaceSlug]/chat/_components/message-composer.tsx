'use client';
import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useSendMessage } from '@/hooks/use-chat';
import { useChatStore } from '@/stores/chat-store';
import { useAuthStore } from '@/stores/auth-store';

export function MessageComposer({ channelId }: { channelId: string }) {
  const [text, setText] = useState('');
  const send = useSendMessage(channelId);
  const socket = useChatStore((s) => s.socket);
  const me = useAuthStore((s) => s.user);
  const lastTyped = useRef(0);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate({ body });
    setText('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Emit typing at most every 2s; the server throttles further.
    const now = Date.now();
    if (socket && now - lastTyped.current > 2000) {
      lastTyped.current = now;
      socket.emit('chat:typing', { channelId, name: me?.name ?? '' });
    }
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-end gap-2 bg-bg-input border border-border rounded-md px-3 py-2 focus-within:border-accent transition-colors">
        <textarea
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Write a message…  (Enter to send, Shift+Enter for newline)"
          className="flex-1 resize-none bg-transparent text-[13px] outline-none max-h-40 placeholder:text-text-muted"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || send.isPending}
          title="Send"
          className="w-8 h-8 flex-shrink-0 rounded-sm bg-accent text-white flex items-center justify-center disabled:opacity-40 hover:opacity-90"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
