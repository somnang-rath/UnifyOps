'use client';
import { resolvePaneView } from './pane-registry';
import { cn } from '@/lib/utils';

/** Append the chrome-less flag so iframe panes render without nested chrome. */
function bareSrc(route: string): string {
  return route + (route.includes('?') ? '&' : '?') + 'chrome=0';
}

/**
 * Decides how a pane's route is rendered:
 *  - `__current__` → the live Next.js route (`liveContent`)
 *  - a registered route → native React (shared state, no reload)
 *  - anything else → an <iframe> of the route in chrome-less mode
 */
export function PaneContent({
  route,
  liveContent,
  title,
}: {
  route: string;
  liveContent?: React.ReactNode;
  title?: string;
}) {
  if (route === '__current__') {
    return <div className="px-6 py-5">{liveContent}</div>;
  }

  const entry = resolvePaneView(route);
  if (entry) {
    const { Component, padded = true } = entry;
    return (
      <div className={cn('h-full', padded && 'px-6 py-5')}>
        <Component route={route} />
      </div>
    );
  }

  return (
    <iframe
      src={bareSrc(route)}
      title={title}
      className="w-full h-full border-0 block"
    />
  );
}
