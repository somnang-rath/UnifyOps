'use client';
import { MessageSquare } from 'lucide-react';

/** Landing pane before a channel is selected. */
export default function ChatIndexPage() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-text-muted">
      <MessageSquare className="w-10 h-10" />
      <div className="text-[14px] font-medium text-text">Pick a channel</div>
      <p className="text-[13px] max-w-xs">
        Choose a channel or direct message on the left, or create a new one to
        start talking.
      </p>
    </div>
  );
}
