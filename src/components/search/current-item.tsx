'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * Which work item is on screen, told to the shell (slice 14).
 *
 * §7.9's Actions section names "assign to me", which only means anything when
 * there is an item to assign — and the palette lives in the workspace **layout**
 * while the item lives on a page inside it. React context flows down, so the
 * page cannot provide to the shell that renders it, and lifting the item into
 * the layout would make every workspace screen fetch an item it does not have.
 *
 * A module-level store read through `useSyncExternalStore` is the ordinary
 * answer to "a deep page registers something the shell shows". It is one value,
 * client-only, and it is *derived from the page* rather than being state
 * anything mutates: the item page publishes on mount and retracts on unmount, so
 * the action offered by the palette is always the action for the thing you are
 * looking at.
 *
 * Deliberately not a context, a global variable read directly, or a search-param
 * sniff on the pathname. The first cannot reach upward; the second would not
 * re-render the palette when it changed; the third would give the palette a URL
 * to parse and still leave it without the assignee list it needs to add somebody
 * *to* rather than replace them.
 */

export type CurrentItem = {
  id: string;
  number: number;
  projectId: string;
  projectSlug: string;
  identifier: string;
  /** Everyone assigned right now — "assign to me" adds, it does not replace (§4). */
  assigneeIds: string[];
};

let current: CurrentItem | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Null on the server, where there is no "current screen" to speak of. */
function serverSnapshot(): CurrentItem | null {
  return null;
}

export function useCurrentItem(): CurrentItem | null {
  return useSyncExternalStore(subscribe, () => current, serverSnapshot);
}

/**
 * Rendered by the item page. No markup — it exists for its effect.
 *
 * The cleanup clears only if *this* item is still the current one: two item
 * pages overlap for one commit during a client navigation, and a cleanup that
 * cleared unconditionally would run after the next page had already published,
 * leaving the palette with no item on the screen that has one.
 */
export function RegisterCurrentItem({ item }: { item: CurrentItem }) {
  // The assignee list changes as somebody edits, and the identity of the object
  // changes on every render — so the effect keys on the values, not the object.
  const assignees = item.assigneeIds.join(',');

  useEffect(() => {
    current = item;
    emit();
    return () => {
      if (current?.id === item.id) {
        current = null;
        emit();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.number, item.projectId, item.projectSlug, item.identifier, assignees]);

  return null;
}
