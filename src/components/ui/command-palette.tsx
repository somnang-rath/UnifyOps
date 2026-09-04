'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Skeleton } from './feedback';
import { Dialog } from './dialog';
import { cn } from '@/lib/cn';

/**
 * §12's CommandPalette (slice 14) — the primitive, which knows nothing about
 * work items, tenancy or the router.
 *
 * It takes sections of options and reports which one was chosen. Everything that
 * makes it §7.9's search — the fetch, the `ENG-142` short-circuit, the actions —
 * lives in `src/components/search/workspace-palette.tsx`, per the composition
 * rule that a primitive takes props and renders.
 *
 * **The keyboard contract is the component.** A palette is used almost entirely
 * without a mouse, and §11's baseline is not "usable with a keyboard" but
 * "keyboard-operable throughout":
 *
 *   * Arrow keys move through *every* option, across section boundaries, because
 *     the sections are headings rather than groups a person navigates between.
 *   * Home and End go to the first and last option, not to the ends of the text.
 *     That is the trade a combobox makes and it is the right one here: the input
 *     is one line and rarely re-edited, the list is the thing being navigated.
 *   * Enter takes the active option. Escape closes — handled by the `<dialog>`.
 *   * The active option scrolls itself into view, because arrowing past the fold
 *     with nothing moving is indistinguishable from nothing happening.
 *
 * **The ARIA pattern is combobox-on-the-input**, exactly as slice 8's mention
 * picker does it, and for the same reason: focus never leaves the text field, so
 * the field is what must carry `aria-expanded`, `aria-controls` and
 * `aria-activedescendant`. Moving focus into the list would stop the typing that
 * drives it.
 *
 * §7.9's five states, each of which is a prop rather than an assumption:
 *
 *   * **Loading** — `loading` shows a bar and, critically, *keeps the sections
 *     already on screen*. §7.9: "results skeleton, previous results stay visible
 *     while typing." A list that empties on every keystroke flickers, and the
 *     eye reads flicker as failure. `skeleton` is the first-load case, where
 *     there is nothing to keep.
 *   * **Empty** — `emptyContent`, which §7.9 asks to carry a create option
 *     rather than a shrug.
 *   * **Success** — the sections.
 *   * **Error** — `errorContent`, rendered in place of the list with the input
 *     untouched, because §11 requires an error to retain what was typed.
 *   * **Edge** — a long title truncates by grapheme at the call site; an option
 *     with no hint simply has none; a section with no options is not rendered at
 *     all, so a heading never stands over nothing.
 */

export type PaletteOption = {
  /** Unique across every section — it becomes the DOM id `aria-activedescendant` names. */
  id: string;
  label: ReactNode;
  /** Where it lives, or what it does. Right-aligned, muted, never the only clue. */
  hint?: ReactNode;
  /** Leading glyph. Decorative: the label carries the meaning. */
  icon?: ReactNode;
  onSelect: () => void;
};

export type PaletteSection = {
  id: string;
  heading: string;
  options: PaletteOption[];
  /** Rendered after the section's options — "see all 42 results", typically. */
  footer?: ReactNode;
};

export function CommandPalette({
  open,
  onClose,
  value,
  onValueChange,
  label,
  placeholder,
  sections,
  loading = false,
  skeleton = false,
  emptyContent,
  errorContent,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  value: string;
  onValueChange: (value: string) => void;
  /** The dialog's accessible name, and the input's. */
  label: string;
  placeholder: string;
  sections: PaletteSection[];
  loading?: boolean;
  skeleton?: boolean;
  emptyContent?: ReactNode;
  errorContent?: ReactNode;
  footer?: ReactNode;
}) {
  const listId = useId();
  const optionPrefix = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * The active option is held by **id**, not by index, and that is what removes
   * the reset this component used to need.
   *
   * An index into a list that is replaced on every keystroke has to be reset
   * whenever the list changes — an effect, a cascading render, and a rule the
   * React lint is right to refuse. An id simply stops resolving when its option
   * leaves the list, and `activeIndex` below falls back to the first row, which
   * is the behaviour the reset was written to produce: after another letter the
   * previous best answer is often no longer an answer, and Enter should always
   * take the best current one.
   */
  const [activeKey, setActiveKey] = useState<string | null>(null);

  /**
   * Every option in display order, which is what the arrow keys walk.
   *
   * Flattened rather than navigated section by section: the sections are
   * headings, not groups, and a person pressing Down at the bottom of "Work
   * items" means the first project — not nothing.
   */
  const flat = useMemo(() => sections.flatMap((section) => section.options), [sections]);

  const found = activeKey === null ? -1 : flat.findIndex((option) => option.id === activeKey);
  const activeIndex = found >= 0 ? found : 0;

  // Focus the input when the dialog opens. `showModal` focuses the first
  // focusable descendant on its own, which is this input today — but that is a
  // property of the current markup rather than a promise, and a palette that
  // opens without a caret is a palette that does nothing when you type.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const active = flat[activeIndex];
  const activeId = active === undefined ? undefined : `${optionPrefix}-${active.id}`;

  // Arrowing past the fold with nothing moving is indistinguishable from nothing
  // happening. `nearest` rather than `center`, so a keypress does not jump the
  // list when the option is already visible.
  useEffect(() => {
    if (activeId === undefined) return;
    listRef.current?.querySelector(`[id="${CSS.escape(activeId)}"]`)?.scrollIntoView({
      block: 'nearest',
    });
  }, [activeId]);

  const move = (delta: number) => {
    if (flat.length === 0) return;
    // Wrapping, because a list reached from a text field has no visible edge to
    // tell you that you are at the end of it.
    const next = flat[(activeIndex + delta + flat.length) % flat.length];
    if (next !== undefined) setActiveKey(next.id);
  };

  const moveTo = (index: number) => {
    const next = flat[index];
    if (next !== undefined) setActiveKey(next.id);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(Math.max(flat.length - 1, 0));
        break;
      case 'Enter':
        if (active !== undefined) {
          event.preventDefault();
          active.onSelect();
        }
        break;
      default:
        break;
    }
  };

  const hasOptions = flat.length > 0;

  return (
    <Dialog open={open} onClose={onClose} size="lg" label={label} className="mt-[8vh]">
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={hasOptions}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={onKeyDown}
          // No `outline-none`. The input is the only focusable thing in the
          // dialog, so it is the one place a focus ring has to be visible —
          // §11's baseline, and the global `:focus-visible` rule draws it.
          className="h-11 min-w-0 flex-1 rounded-xs bg-transparent text-sm text-text placeholder:text-text-subtle"
        />
      </div>

      {/* Always in the DOM and always 1px tall, so the list below never shifts
          when a fetch starts. §11: "never layout shift on arrival." */}
      <div aria-hidden="true" className="h-px w-full overflow-hidden bg-border">
        {loading && <div className="h-px w-1/3 animate-pulse bg-accent" />}
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        className="max-h-[min(60vh,28rem)] overflow-y-auto overscroll-contain py-1"
      >
        {errorContent !== undefined ? (
          <div className="px-3 py-6 text-sm text-text-muted">{errorContent}</div>
        ) : skeleton ? (
          <SkeletonRows />
        ) : hasOptions ? (
          sections
            // A heading standing over nothing is worse than no heading: it reads
            // as a section that failed rather than one with no answers.
            .filter((section) => section.options.length > 0)
            .map((section) => (
              <div key={section.id} role="group" aria-labelledby={`${optionPrefix}-${section.id}`}>
                <p
                  id={`${optionPrefix}-${section.id}`}
                  className="px-3 pt-2 pb-1 text-2xs font-medium tracking-wide text-text-subtle uppercase"
                >
                  {section.heading}
                </p>
                {section.options.map((option) => {
                  const id = `${optionPrefix}-${option.id}`;
                  return (
                    <div
                      key={option.id}
                      id={id}
                      role="option"
                      aria-selected={id === activeId}
                      // Pointer only. Focus stays in the input, so this is not a
                      // tab stop and must not become one — `role="option"` in a
                      // listbox the input owns is reached by arrow keys.
                      onPointerDown={(event) => {
                        // Keeps the caret in the input: a mousedown on a div
                        // blurs the field, and the dialog's own click handler
                        // then has nothing sensible to restore focus to.
                        event.preventDefault();
                        option.onSelect();
                      }}
                      onPointerMove={() => setActiveKey(option.id)}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                        id === activeId ? 'bg-surface-hover text-text' : 'text-text',
                      )}
                    >
                      {option.icon !== undefined && (
                        <span aria-hidden="true" className="shrink-0 text-text-subtle">
                          {option.icon}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint !== undefined && (
                        <span className="shrink-0 text-xs text-text-subtle">{option.hint}</span>
                      )}
                    </div>
                  );
                })}
                {section.footer !== undefined && (
                  <div className="px-3 pb-1 text-xs">{section.footer}</div>
                )}
              </div>
            ))
        ) : (
          <div className="px-3 py-6 text-sm text-text-muted">{emptyContent}</div>
        )}
      </div>

      {footer !== undefined && (
        <div className="border-t border-border px-3 py-2 text-xs text-text-subtle">{footer}</div>
      )}
    </Dialog>
  );
}

/**
 * The first-load state only. Once anything has been shown, §7.9 asks for the
 * previous results to stay while the next ones arrive — so this is what fills a
 * palette that has never had an answer, not what replaces one that has.
 */
function SkeletonRows() {
  return (
    <div className="space-y-1 p-3">
      {[0, 1, 2, 3].map((row) => (
        <Skeleton key={row} className="h-5" />
      ))}
    </div>
  );
}
