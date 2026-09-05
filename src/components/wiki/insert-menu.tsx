'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { InsertionId } from '@/lib/editor-commands';

/**
 * The `/` menu's list (§21.5 — slice 20).
 *
 * **A popover anchored to a caret, not a dialog**, which is slice 8's mention
 * picker rather than slice 14's command palette — and the distinction is the
 * same one CLAUDE.md already records: "a Combobox is a form control with a
 * value, this is an inline autocomplete anchored to a caret that cannot take
 * focus without stopping the typing that drives it." §21.5 calls this
 * "`command-palette.tsx`'s contract, third use", and it is the *contract* that
 * is reused — arrows, Home/End, Enter, wrapping, and the ARIA combobox pattern
 * announced on the **textarea** — not the modal the palette happens to live in.
 *
 * So this component holds no state and takes no focus. It renders a listbox and
 * reports a choice; the editor owns the query, the highlight and the caret,
 * because all three are properties of the textarea it cannot be separated from.
 *
 * **Not §12's Dropdown, and not a second one.** A Dropdown is a menu opened by a
 * button that owns focus while it is open. Nothing here opens, nothing here
 * takes focus, and the trigger is a character in a document.
 */
export function InsertMenu({
  ids,
  highlighted,
  listId,
  optionId,
  onChoose,
}: {
  ids: readonly InsertionId[];
  highlighted: number;
  listId: string;
  optionId: (index: number) => string;
  onChoose: (id: InsertionId) => void;
}) {
  const t = useTranslations('wiki');

  if (ids.length === 0) return null;

  return (
    <div
      id={listId}
      role="listbox"
      aria-label={t('editor.insert.listLabel')}
      /**
       * `absolute` under a `relative` wrapper, and the wrapper is not optional:
       * slice 16's responsive sweep found that an absolutely-positioned
       * descendant of a `position: static` parent resolves against the initial
       * containing block and grows the *document* — the `sr-only` labels in the
       * notification grid, 430px into a 512px table. The editor's wrapper
       * carries `relative` for exactly this reason.
       *
       * `max-h` with its own scroll so ten entries cannot push the page taller
       * than the viewport on a phone.
       */
      className="absolute z-20 mt-1 max-h-64 w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-md"
    >
      {ids.map((id, index) => (
        <button
          key={id}
          type="button"
          id={optionId(index)}
          role="option"
          aria-selected={index === highlighted}
          /**
           * `-1`, because the list is not a tab stop and must not become one —
           * the same rule the mention picker and the palette follow. Focus stays
           * in the textarea; `aria-activedescendant` there is what a screen
           * reader follows.
           */
          tabIndex={-1}
          /**
           * `onMouseDown` with `preventDefault`, never `onClick`: a click blurs
           * the textarea first, and a blurred textarea has no selection to
           * insert into — the caret would be lost before the handler ran.
           */
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(id);
          }}
          className={cn(
            'flex w-full items-baseline justify-between gap-2 rounded-sm px-2 py-1 text-start text-xs',
            index === highlighted ? 'bg-surface-sunken text-text' : 'text-text-muted',
          )}
        >
          <span>{t(`editor.insert.${id}`)}</span>
          {/*
            The syntax it writes, shown beside the name — this menu's whole
            argument is that it inserts text a person could have typed, so
            showing the text is how somebody learns to stop needing the menu.
          */}
          <span aria-hidden="true" className="shrink-0 font-mono text-2xs text-text-subtle">
            {HINT[id]}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Not translated, and deliberately: these are the literal characters the entry
 * writes into the body. `##` is `##` in every language, exactly as slice 14's
 * key caps are — "`⌘` and `Ctrl` are things on a keyboard, not words."
 */
const HINT: Record<InsertionId, string> = {
  heading: '##',
  bulletList: '-',
  numberedList: '1.',
  todo: '- [ ]',
  quote: '>',
  callout: '[!info]',
  toggle: '[!info]-',
  code: '```',
  table: '| |',
  divider: '---',
};
