'use client';

import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { NoteComposer } from './note-composer';

/**
 * §20.3.1's capture, from anywhere: `⌘K` → "New note" → type → `⌘Enter` saves
 * and closes.
 *
 * **A dialog rather than a mode inside the palette**, and the choice is about
 * what each control is for. `CommandPalette` owns a keyboard contract in which
 * every key either filters a list or moves through it — arrows, Home, End,
 * Enter — and a textarea inside it would have to take all of those back to be
 * usable, which would leave one component with two incompatible keyboard
 * models. §12's Dialog is already the platform's focus trap, and slice 14 built
 * it precisely so the second thing that needed one would not need anything new.
 *
 * The five-second target survives the extra element because nothing is added to
 * the *path*: the palette closes and this opens in the same tick, with the
 * textarea focused, so the keystrokes are unchanged from what §20.3.1 writes
 * down.
 *
 * **The item on screen is offered as a pin and never imposed** (§20.3.1's
 * `[!]`): "offered a one-click pin to that item, taken or not". It is a
 * checkbox, defaulted **off**, because a note captured while an item happens to
 * be open is usually about the meeting rather than about the item — and a pin
 * somebody did not ask for is a note filed somewhere they will not look.
 *
 * §12's "Escape closes unless there are unsaved changes" is still not
 * implemented, and this is the first caller that *could* want it — a half-typed
 * note is exactly the unsaved change the rule is about. It is left alone
 * deliberately: adding a confirmation to this dialog would put a second decision
 * in front of somebody in the middle of a five-second path, and the honest fix
 * is a draft that survives the close, which is §20.3.2's browser-local draft and
 * belongs with the page editor that needs it.
 */
export function NoteCapture({
  open,
  onClose,
  workspaceSlug,
  locale,
  item,
}: {
  open: boolean;
  onClose: () => void;
  workspaceSlug: string;
  locale: string;
  /** The work item on screen, if there is one — `useCurrentItem`'s store. */
  item: { id: string; identifier: string } | null;
}) {
  const t = useTranslations();

  return (
    <Dialog open={open} onClose={onClose} size="md" label={t('notes.capture.title')}>
      <div className="space-y-3 p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-text">{t('notes.capture.title')}</h2>
          <p className="text-xs text-text-subtle">{t('notes.privacy')}</p>
        </div>

        {/*
          Mounted only while the dialog is open, and that is not a micro
          optimisation. A native `<dialog>` that is closed is still in the
          document — merely `display: none` — so a permanently-mounted composer
          would put a *second* note textarea on every workspace screen, behind
          the one the notes page renders. The e2e run found it immediately, and
          a person using a screen reader's form-controls list would have found it
          the same way. Mounting on open also gives each capture a fresh, empty
          box and makes `autoFocus` fire, which a persistent one would not.
        */}
        {open ? (
          <NoteComposer
            workspaceSlug={workspaceSlug}
            locale={locale}
            autoFocus
            workItemId={null}
            pinChoice={item}
            onSaved={onClose}
          />
        ) : null}
      </div>
    </Dialog>
  );
}
