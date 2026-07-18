/**
 * @mention support for the RichTextEditor.
 *
 * - Node renders as `@label` in the editor (class `mention`).
 * - Serializes to markdown as `@<id>` (the email local-part) so it matches the
 *   web app's `remarkMentions` renderer — i.e. round-trips through the existing
 *   markdown storage path unchanged.
 * - Suggestion popup is a lightweight vanilla-DOM list (no React portal), so the
 *   extension stays self-contained inside @prism/editor.
 */
import Mention from '@tiptap/extension-mention';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';

export interface MentionUser {
  name: string;
  email: string;
}

interface MentionItem {
  id: string;
  label: string;
  email: string;
}

function toItem(u: MentionUser): MentionItem {
  return { id: u.email.split('@')[0], label: u.name, email: u.email };
}

function scoreUser(u: MentionUser, q: string): number {
  const name = u.name.toLowerCase();
  const local = u.email.split('@')[0].toLowerCase();
  if (q === '') return 1;
  if (local.startsWith(q)) return 4;
  if (name.startsWith(q)) return 3;
  if (local.includes(q) || name.includes(q)) return 2;
  return 0;
}

/** Build the suggestion `render` handler backed by a floating DOM list. */
function makeRenderer(): SuggestionOptions<MentionItem>['render'] {
  return () => {
    let el: HTMLDivElement | null = null;
    let items: MentionItem[] = [];
    let selected = 0;
    let cmd: SuggestionProps<MentionItem>['command'] | null = null;

    const paint = () => {
      if (!el) return;
      el.innerHTML = '';
      if (items.length === 0) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      items.forEach((it, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className =
          'prism-mention-item' + (i === selected ? ' is-active' : '');
        row.innerHTML =
          `<span class="prism-mention-name"></span>` +
          `<span class="prism-mention-handle"></span>`;
        (row.querySelector('.prism-mention-name') as HTMLElement).textContent =
          it.label;
        (row.querySelector('.prism-mention-handle') as HTMLElement).textContent =
          '@' + it.id;
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          cmd?.(it);
        });
        row.addEventListener('mouseenter', () => {
          selected = i;
          paint();
        });
        el!.appendChild(row);
      });
    };

    const place = (rect: DOMRect | null | undefined) => {
      if (!el || !rect) return;
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.bottom + 4}px`;
    };

    return {
      onStart: (props) => {
        items = props.items;
        selected = 0;
        cmd = props.command;
        el = document.createElement('div');
        el.className = 'prism-mention-popup';
        document.body.appendChild(el);
        paint();
        place(props.clientRect?.());
      },
      onUpdate: (props) => {
        items = props.items;
        selected = 0;
        cmd = props.command;
        paint();
        place(props.clientRect?.());
      },
      onKeyDown: (props) => {
        if (!items.length) return false;
        if (props.event.key === 'ArrowDown') {
          selected = (selected + 1) % items.length;
          paint();
          return true;
        }
        if (props.event.key === 'ArrowUp') {
          selected = (selected - 1 + items.length) % items.length;
          paint();
          return true;
        }
        if (props.event.key === 'Enter' || props.event.key === 'Tab') {
          cmd?.(items[selected]);
          return true;
        }
        if (props.event.key === 'Escape') {
          el?.remove();
          el = null;
          return true;
        }
        return false;
      },
      onExit: () => {
        el?.remove();
        el = null;
      },
    };
  };
}

/**
 * Create a Mention extension bound to a live user list. `getUsers` is read on
 * every keystroke so the editor can be created once while the roster updates.
 */
export function createMention(getUsers: () => MentionUser[]) {
  return Mention.extend({
    // Serialize to `@<id>` so it matches the markdown mention convention.
    addStorage() {
      return {
        markdown: {
          serialize(state: { write: (s: string) => void }, node: { attrs: { id?: string; label?: string } }) {
            state.write('@' + (node.attrs.id ?? node.attrs.label ?? ''));
          },
          parse: {},
        },
      };
    },
  }).configure({
    HTMLAttributes: { class: 'mention' },
    renderText({ node }) {
      return `@${node.attrs.label ?? node.attrs.id}`;
    },
    suggestion: {
      char: '@',
      items: ({ query }): MentionItem[] => {
        const q = query.toLowerCase();
        return getUsers()
          .map((u) => ({ u, s: scoreUser(u, q) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s || a.u.name.localeCompare(b.u.name))
          .slice(0, 6)
          .map((x) => toItem(x.u));
      },
      render: makeRenderer(),
    },
  });
}
