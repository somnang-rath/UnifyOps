'use client';
import { useEffect } from 'react';
import { useAssistantStore } from '@/stores/assistant-store';
import type { ChatContext } from '@/schemas/assistant';

/**
 * Attach grounding context from the current screen to the assistant while this
 * component is mounted (e.g. the open wiki page or issue). Clears it on unmount
 * so the assistant doesn't keep stale context after navigating away.
 *
 * Pass `null` when nothing is selected. Re-attaches only when the identity of
 * the context changes (not on every render), so callers can pass an object
 * literal safely.
 */
export function useAssistantContext(context: ChatContext | null) {
  const setContext = useAssistantStore((s) => s.setContext);
  const key = context
    ? `${context.type}:${context.id ?? ''}:${context.title ?? ''}:${
        context.text?.length ?? 0
      }`
    : '';

  useEffect(() => {
    setContext(context);
    return () => setContext(null);
    // Re-run only when the serialized identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setContext]);
}
