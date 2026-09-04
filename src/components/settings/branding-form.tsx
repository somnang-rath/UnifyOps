'use client';

import { useActionState, useRef, useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { useToast } from '@/components/ui/toast';
import { ACCENT_COLORS, LOGO_MAX_BYTES, isLogoType, type AccentColor } from '@/lib/branding';
import { ROW_IDLE, type RowActionState } from '@/lib/form-state';
import { cn } from '@/lib/cn';
import {
  clearLogoAction,
  saveAccentAction,
} from '@/app/[locale]/[workspaceSlug]/settings/branding/actions';

/**
 * §6-7's branding: the accent colour and the company logo.
 *
 * **The accent picker is a radio group over token names, not a colour picker.**
 * There is no hex input and there will not be one: a colour stored as a value
 * cannot resolve differently in dark mode, and §12's whole three-layer
 * architecture exists so that no colour in the product is a value at a call
 * site. What a company picks is a name; `globals.css` decides what it means on
 * each ground. The four choices are the brand colours that survive a contrast
 * check as a fill in both themes — see `src/lib/branding.ts` for why Crimson is
 * not among them.
 *
 * **The logo upload is slice 8's two-step, reused.** The browser asks for a
 * ticket, PUTs the bytes straight to the store, then tells the server the key —
 * so no byte passes through the app server (§8). The only difference is that
 * there is no `pending` row to sweep: the row this writes is a column on a
 * workspace that already exists.
 */

export function BrandingForm({
  workspaceSlug,
  accent,
  logoUrl,
}: {
  workspaceSlug: string;
  accent: AccentColor | null;
  logoUrl: string | null;
}) {
  const t = useTranslations('settings.branding');

  return (
    <div className="space-y-8">
      <AccentPicker workspaceSlug={workspaceSlug} accent={accent} />
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="font-display text-sm font-semibold tracking-tight">{t('logo')}</h3>
          <p className="text-sm text-text-muted">{t('logoHelp')}</p>
        </div>
        <LogoUpload workspaceSlug={workspaceSlug} logoUrl={logoUrl} />
      </section>
    </div>
  );
}

function AccentPicker({
  workspaceSlug,
  accent,
}: {
  workspaceSlug: string;
  accent: AccentColor | null;
}) {
  const t = useTranslations('settings.branding');
  const tRoot = useTranslations();
  const locale = useLocale();
  const [state, action, pending] = useActionState<RowActionState, FormData>(
    saveAccentAction,
    ROW_IDLE,
  );

  // The default is null in the database and `navy` on screen, which are the same
  // colour and different facts (§6: a setting is an override of a working
  // default). The radio shows the effective value; saving `navy` records a
  // choice, and "use the default" clears it.
  const [selected, setSelected] = useState<string>(accent ?? '');

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="workspaceSlug" value={workspaceSlug} />

      {state.error && <Alert tone="danger">{tRoot(state.error)}</Alert>}

      <fieldset className="space-y-2">
        <legend className="font-display text-sm font-semibold tracking-tight">{t('accent')}</legend>
        <p className="text-sm text-text-muted">{t('accentHelp')}</p>

        <div className="flex flex-wrap gap-2 pt-1">
          <AccentSwatch
            value=""
            label={t('accentDefault')}
            checked={selected === ''}
            onSelect={setSelected}
          />
          {ACCENT_COLORS.map((color) => (
            <AccentSwatch
              key={color}
              value={color}
              label={t(`accents.${color}`)}
              checked={selected === color}
              onSelect={setSelected}
            />
          ))}
        </div>
      </fieldset>

      <Button type="submit" variant="primary" loading={pending}>
        {tRoot('action.save')}
      </Button>
    </form>
  );
}

/**
 * One choice.
 *
 * A real `<input type="radio">` under a label, not a styled `div` with a click
 * handler: the radio gives the group its arrow-key behaviour, its role and its
 * name association for free, and §11's baseline is that everything works from a
 * keyboard. The visual selection is a ring **and** a check mark, because §11
 * also says nothing is signalled by colour alone — which matters more here than
 * anywhere else in the product, since the thing being chosen *is* a colour.
 *
 * The swatch itself sets `data-accent` on its own element, so what a person sees
 * is the actual token resolving on the actual ground, in whichever theme they
 * are in — not a hard-coded approximation of it that could drift from
 * `globals.css`.
 */
function AccentSwatch({
  value,
  label,
  checked,
  onSelect,
}: {
  value: string;
  label: string;
  checked: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm border px-2.5 py-1.5 text-sm',
        'transition-colors duration-120 ease-[var(--ease-out-soft)]',
        /*
         * The focus ring has to be drawn by the label, and this is the one
         * place in the product where that is true.
         *
         * `globals.css` gives every `:focus-visible` an outline, which is why
         * no other component states one. That rule cannot reach this input:
         * `sr-only` clips it to a 1px box, so the outline is drawn correctly
         * and clipped away with it. A keyboard user would arrow through four
         * colours with nothing on screen moving — §11's baseline is that focus
         * is visible at every stop, and the radio being real is what makes it
         * a stop at all.
         *
         * Matched to the global rule's own width and offset rather than
         * invented, so the ring is the same one everywhere in the product.
         */
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
        'has-[:focus-visible]:outline-focus-ring',
        checked
          ? 'border-accent bg-accent-subtle font-medium text-text'
          : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text',
      )}
    >
      <input
        type="radio"
        name="accent"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      <span
        aria-hidden
        data-accent={value || undefined}
        className="size-4 rounded-full border border-border-strong bg-accent"
      />
      {label}
      {checked && (
        <span aria-hidden className="text-accent">
          ✓
        </span>
      )}
    </label>
  );
}

/**
 * The logo, uploaded straight to the store.
 *
 * Both checks run in the browser *and* on the server, and the browser's is a
 * courtesy: `createLogoTicket` re-runs them, and the store refuses a PUT that
 * disagrees with the length and type that were signed. What the client check
 * buys is telling somebody their 4 MB photograph is too big before they spend a
 * minute of a mobile connection on it (§2.5).
 */
function LogoUpload({ workspaceSlug, logoUrl }: { workspaceSlug: string; logoUrl: string | null }) {
  const t = useTranslations('settings.branding');
  const tRoot = useTranslations();
  const locale = useLocale();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [, clearAction, clearing] = useActionState<RowActionState, FormData>(
    clearLogoAction,
    ROW_IDLE,
  );

  async function upload(file: File) {
    setError(null);

    if (!isLogoType(file.type)) return setError('settings.branding.errors.unsupported_type');
    if (file.size > LOGO_MAX_BYTES) return setError('settings.branding.errors.too_large');

    const ticketResponse = await fetch('/api/internal/upload/logo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceSlug, contentType: file.type, sizeBytes: file.size }),
    });

    if (!ticketResponse.ok) {
      const body = (await ticketResponse.json().catch(() => null)) as { error?: string } | null;
      // A problem identifier from the server, resolved against the catalogue
      // here — never a sentence off the wire (§13).
      return setError(`settings.branding.errors.${body?.error ?? 'unknown'}`);
    }

    const ticket = (await ticketResponse.json()) as {
      key: string;
      upload: { url: string; method: 'PUT'; headers: Record<string, string> };
    };

    const put = await fetch(ticket.upload.url, {
      method: ticket.upload.method,
      headers: ticket.upload.headers,
      body: file,
    });

    if (!put.ok) return setError('settings.branding.errors.upload_failed');

    const confirmed = await fetch('/api/internal/upload/logo', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspaceSlug, key: ticket.key }),
    });

    if (!confirmed.ok) return setError('settings.branding.errors.upload_failed');

    // The header on every screen changes, and the person is looking at this
    // panel rather than at it — which is exactly §11's rule for when a toast is
    // warranted and when it is noise.
    toast({ tone: 'info', message: t('logoSaved') });
    // A full reload rather than `router.refresh()`: the logo is rendered by the
    // workspace *layout*, and a refresh of this route re-renders the page
    // beneath a header that would keep the old signed URL until navigation.
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{tRoot(error)}</Alert>}

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-16 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-sunken">
          {logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- a signed,
               short-lived URL from our own object store; `next/image` would
               proxy and cache a URL that expires in ten minutes. */
            <img src={logoUrl} alt={t('logoAlt')} className="size-full object-contain" />
          ) : (
            <span className="text-xs text-text-subtle">{t('noLogo')}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            /*
             * Out of the tab order, unlike the accent radios above, and the
             * contrast between the two is the rule rather than an
             * inconsistency. A radio is the control a person operates, so it
             * stays a tab stop and the label draws its ring. This input is
             * never operated directly — the Button beside it opens the picker
             * — so left tabbable it would be an unlabelled stop with nothing
             * visible on screen, which is the failure the ring above exists to
             * prevent, in the one form it cannot be fixed by drawing anything.
             */
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so choosing the same file twice — after a failure —
              // fires `change` again.
              event.target.value = '';
              if (file) startUpload(() => void upload(file));
            }}
          />
          <Button
            type="button"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {logoUrl ? t('replaceLogo') : t('uploadLogo')}
          </Button>

          {logoUrl && (
            <form action={clearAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="workspaceSlug" value={workspaceSlug} />
              <Button type="submit" variant="ghost" loading={clearing}>
                {t('removeLogo')}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
