'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowRight,
  CircleDot,
  FolderOpen,
  Hash,
  Languages,
  Search,
  SunMoon,
  User,
  UserPlus,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { CommandPalette, type PaletteSection } from '@/components/ui/command-palette';
import { ShortcutHelp } from './shortcut-help';
import { useCurrentItem } from './current-item';
import { assignToMeAction } from '@/app/[locale]/[workspaceSlug]/actions';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/routing';
import { useToast } from '@/components/ui/toast';
import {
  actionMatches,
  availableActions,
  isSearchable,
  normalizeQuery,
  parseItemReference,
  type PaletteAction,
} from '@/lib/search';
import { advance, isMacLike, keystrokeOf, type Keystroke } from '@/lib/shortcuts';

/**
 * §7.9's command palette, wired (slice 14).
 *
 * Mounted once in the workspace layout, which is what makes ⌘K mean the same
 * thing on every screen — §2.4: "not knowing where something lives stops being a
 * problem." Everything about *how a palette behaves* is in the
 * `CommandPalette` primitive; this component decides what is in it.
 *
 * Three things here are worth reading before changing any of them.
 *
 * **Actions are matched in the browser and results on the server**, and the
 * split is not arbitrary: an action's label only exists in the message
 * catalogues, so only the client knows what "switch language" is called in
 * Khmer, and nine entries filtered locally are the fastest answer the palette
 * can give. Work items, projects and people are the company's data and are
 * matched where the company's data is.
 *
 * **The previous results stay on screen while the next ones arrive** (§7.9's
 * `[L]`). A list that empties on each keystroke flickers, and flicker reads as
 * failure. The skeleton is reserved for the first fetch, when there is nothing
 * to keep.
 *
 * **Every fetch aborts the one before it.** Without that, a slow answer to "lo"
 * can land after a fast answer to "login" and quietly replace it — the results
 * would appear to go backwards as you type, which is the single most common way
 * a search box feels broken.
 */

type PaletteItem = {
  id: string;
  identifier: string;
  title: string;
  projectSlug: string;
  projectName: string;
  number: number;
  archived: boolean;
};

type PaletteProject = {
  id: string;
  slug: string;
  key: string;
  name: string;
  archived: boolean;
};

type PalettePerson = {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  active: boolean;
};

type Results = {
  text: string;
  searched: boolean;
  reference: { identifier: string; title: string; projectSlug: string; number: number } | null;
  items: PaletteItem[];
  itemTotal: number;
  projects: PaletteProject[];
  people: PalettePerson[];
};

const EMPTY: Results = {
  text: '',
  searched: false,
  reference: null,
  items: [],
  itemTotal: 0,
  projects: [],
  people: [],
};

/**
 * How long the palette waits after a keystroke before asking the server.
 *
 * Short enough to feel immediate at typing speed and long enough that a
 * five-letter word is one query rather than five. §2.5-5's market is
 * cost-sensitive on mobile data, which is the same reason slice 6 fixed the
 * board's poll interval rather than leaving it to be guessed at.
 */
const DEBOUNCE_MS = 140;

const subscribeNever = () => () => {};

export function CommandBar({
  workspaceSlug,
  canCreateProject,
}: {
  workspaceSlug: string;
  canCreateProject: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const { theme, setTheme } = useTheme();
  const item = useCurrentItem();

  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [value, setValue] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** True until the first answer for this opening arrives — the skeleton's window. */
  const [cold, setCold] = useState(true);

  /**
   * Which modifier the trigger advertises, decided after hydration.
   *
   * `navigator` does not exist on the server, so rendering either symbol during
   * SSR would be wrong for half of all readers and would mismatch. The same
   * "have I hydrated yet" store `ThemeToggle` uses; the server draws `Ctrl`,
   * which this market mostly runs, and it is corrected within a frame.
   */
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const mac = mounted && isMacLike(navigator.platform ?? navigator.userAgent);

  /* --------------------------------------------------------------------- */
  /* Shortcuts                                                             */
  /* --------------------------------------------------------------------- */

  const buffer = useRef<Keystroke[]>([]);
  const lastAt = useRef(0);

  /**
   * Closing is where the palette resets, rather than in an effect watching
   * `open`.
   *
   * Same outcome, no cascading render — and the reason it is worth doing here is
   * that closing is a thing a person does, not a state the component observes.
   * A palette that reopens holding last week's query is one people close again
   * immediately, so every path that closes goes through this.
   */
  const close = useCallback(() => {
    setOpen(false);
    setValue('');
    setResults(EMPTY);
    setFailed(false);
    setCold(true);
  }, []);

  const go = useCallback(
    (path: string) => {
      close();
      router.push(path);
    },
    [close, router],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never while somebody is typing. This is the property that decides
      // whether shortcuts are a feature or a hazard: `/` inside a comment
      // composer must be a slash, and `g` inside a title must be a g.
      if (isTypingTarget(event.target)) return;
      // A modifier chord the browser owns (⌘R, ⌘L) is not ours to intercept,
      // and `keystrokeOf` would otherwise turn ⌘K's neighbours into bindings.
      if (event.shiftKey && event.key.length !== 1) return;

      const key = keystrokeOf(event);
      const now = Date.now();
      const next = advance(buffer.current, key, { now, lastAt: lastAt.current });
      buffer.current = next.buffer;
      lastAt.current = now;

      if (next.result.kind === 'none') return;
      if (next.result.kind === 'pending') {
        // A pending `g` is swallowed so the page does not also see it. Nothing
        // else is: an unmatched key falls through to whatever owns it.
        event.preventDefault();
        return;
      }

      event.preventDefault();
      switch (next.result.id) {
        case 'palette':
        case 'search':
          setOpen(true);
          break;
        case 'help':
          setHelpOpen(true);
          break;
        case 'goMyWork':
          go(`/${workspaceSlug}`);
          break;
        case 'goInbox':
          go(`/${workspaceSlug}/inbox`);
          break;
        case 'goTeam':
          go(`/${workspaceSlug}/team`);
          break;
        case 'goProjects':
          go(`/${workspaceSlug}/projects`);
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [go, workspaceSlug]);

  /* --------------------------------------------------------------------- */
  /* Fetching                                                              */
  /* --------------------------------------------------------------------- */

  useEffect(() => {
    if (!open) return;

    // Below the floor there is nothing to ask. Nothing is *set* here either —
    // the render below reads `EMPTY` whenever the text is too short, so the
    // "sections have nothing to say yet" state is derived rather than stored.
    const text = normalizeQuery(value);
    if (!isSearchable(text)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      const params = new URLSearchParams({ w: workspaceSlug, q: text });
      fetch(`/api/internal/search?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
        .then((payload: Results) => {
          setResults(payload);
          setFailed(false);
          setCold(false);
        })
        .catch((error: unknown) => {
          // An abort is the *expected* outcome of typing another letter, not a
          // failure — reporting it would flash an error on every keystroke.
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, value, workspaceSlug]);

  /* --------------------------------------------------------------------- */
  /* Actions                                                               */
  /* --------------------------------------------------------------------- */

  const runAction = useCallback(
    (action: PaletteAction) => {
      switch (action) {
        case 'goMyWork':
          return go(`/${workspaceSlug}`);
        case 'goInbox':
          return go(`/${workspaceSlug}/inbox`);
        case 'goTeam':
          return go(`/${workspaceSlug}/team`);
        case 'goProjects':
          return go(`/${workspaceSlug}/projects`);
        case 'goSearch':
          return go(`/${workspaceSlug}/search?q=${encodeURIComponent(normalizeQuery(value))}`);
        case 'newProject':
          return go(`/${workspaceSlug}/projects/new`);
        case 'switchLanguage': {
          const next = locales.find((candidate) => candidate !== locale) ?? locale;
          close();
          return router.replace(pathname, { locale: next });
        }
        case 'toggleTheme':
          close();
          return setTheme(theme === 'dark' ? 'light' : 'dark');
        case 'assignToMe': {
          if (item === null) return;
          close();
          // §11: a toast only when the result is not visible on screen. Here it
          // never is — the palette is closing over the panel that would have
          // shown the change — so both outcomes say so.
          void assignToMeAction({
            workspaceSlug,
            workItemId: item.id,
            projectSlug: item.projectSlug,
            number: item.number,
            assigneeIds: item.assigneeIds,
            locale,
          }).then((outcome) => {
            toast(
              outcome.error === undefined
                ? { message: t('search.actions.assignedToMe') }
                : { message: t(outcome.error), tone: 'danger' },
            );
          });
          return;
        }
      }
    },
    [close, go, item, locale, pathname, router, setTheme, t, theme, toast, value, workspaceSlug],
  );

  /* --------------------------------------------------------------------- */
  /* Sections                                                              */
  /* --------------------------------------------------------------------- */

  const text = normalizeQuery(value);
  const reference = parseItemReference(text);

  /**
   * What the sections are actually built from.
   *
   * Below the search floor this is `EMPTY` rather than whatever the last fetch
   * left in state — derived, so deleting back to one character cannot leave
   * yesterday's rows on screen, and so no effect has to reach in and clear them.
   */
  const shown = isSearchable(text) ? results : EMPTY;

  const sections = useMemo<PaletteSection[]>(() => {
    const built: PaletteSection[] = [];

    /**
     * §7.9: "`ENG-142` short-circuits to that item." Its own section, above
     * everything, because the whole point of typing an identifier is that you
     * already know which item you want — burying the answer among five
     * text matches would be a slower way to reach it than the URL bar.
     */
    if (shown.reference !== null) {
      const hit = shown.reference;
      built.push({
        id: 'reference',
        heading: t('search.sections.reference'),
        options: [
          {
            id: `ref-${hit.projectSlug}-${hit.number}`,
            icon: <Hash size={14} strokeWidth={1.5} />,
            label: `${hit.identifier} · ${hit.title}`,
            hint: <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />,
            onSelect: () => go(`/${workspaceSlug}/projects/${hit.projectSlug}/${hit.number}`),
          },
        ],
      });
    }

    if (shown.items.length > 0) {
      built.push({
        id: 'items',
        heading: t('search.sections.items'),
        options: shown.items.map((hit) => ({
          id: `item-${hit.id}`,
          icon: <CircleDot size={14} strokeWidth={1.5} />,
          label: hit.title,
          hint: hit.identifier,
          onSelect: () => go(`/${workspaceSlug}/projects/${hit.projectSlug}/${hit.number}`),
        })),
        footer:
          shown.itemTotal > shown.items.length ? (
            <span className="text-text-subtle">
              {t('search.seeAll', { count: shown.itemTotal })}
            </span>
          ) : undefined,
      });
    }

    if (shown.projects.length > 0) {
      built.push({
        id: 'projects',
        heading: t('search.sections.projects'),
        options: shown.projects.map((project) => ({
          id: `project-${project.id}`,
          icon: <FolderOpen size={14} strokeWidth={1.5} />,
          label: project.name,
          hint: project.archived ? t('projects.archived') : project.key,
          onSelect: () => go(`/${workspaceSlug}/projects/${project.slug}`),
        })),
      });
    }

    if (shown.people.length > 0) {
      built.push({
        id: 'people',
        heading: t('search.sections.people'),
        options: shown.people.map((person) => ({
          id: `person-${person.memberId}`,
          icon: <User size={14} strokeWidth={1.5} />,
          label: person.name,
          // A former member is named rather than hidden (§7.12), and the hint is
          // what stops somebody wondering why they cannot be assigned.
          hint: person.active ? person.email : t('search.formerMember'),
          onSelect: () =>
            go(`/${workspaceSlug}?a=${person.memberId}`),
        })),
      });
    }

    const actions = availableActions({ hasCurrentItem: item !== null })
      .filter((action) => actionMatches(t(`search.actions.${action}`), text))
      .filter((action) => action !== 'newProject' || canCreateProject);

    if (actions.length > 0) {
      built.push({
        id: 'actions',
        heading: t('search.sections.actions'),
        options: actions.map((action) => ({
          id: `action-${action}`,
          icon: ACTION_ICONS[action],
          label: t(`search.actions.${action}`),
          onSelect: () => runAction(action),
        })),
      });
    }

    return built;
  }, [canCreateProject, go, item, shown, runAction, t, text, workspaceSlug]);

  return (
    <>
      {/*
        The visible way in. §11's baseline is not "keyboard-operable *instead*"
        — a shortcut nobody can see is a shortcut nobody uses, and §2.4's
        zero-training test is failed by any feature whose only affordance is a
        key nobody told you about. So the palette has a control, and the control
        wears its own shortcut on it.

        Shaped like an input and not one: a real field here would be a second
        search box that behaves differently from the one in the dialog, and the
        first thing anybody would type into it is a character the dialog should
        have received.
      */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface-sunken px-2 text-xs text-text-subtle transition-colors duration-120 hover:border-border-strong hover:text-text-muted"
      >
        <Search size={14} strokeWidth={1.5} aria-hidden="true" />
        <span className="hidden sm:inline">{t('search.label')}</span>
        <kbd className="hidden rounded-xs border border-border px-1 py-px text-2xs sm:inline">
          {mac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>

      <CommandPalette
        open={open}
        onClose={close}
        value={value}
        onValueChange={setValue}
        label={t('search.label')}
        placeholder={t('search.placeholder')}
        sections={sections}
        loading={loading}
        skeleton={cold && loading && sections.length === 0}
        errorContent={failed ? t('search.failed') : undefined}
        emptyContent={
          isSearchable(text) && shown.searched
            ? t('search.noResults', { query: text })
            : t('search.hint', { min: 2 })
        }
        footer={
          isSearchable(text) ? (
            <span>
              {t('search.footerHint')}
              {reference !== null && shown.reference === null
                ? ` · ${t('search.unknownReference', { identifier: `${reference.key}-${reference.number}` })}`
                : ''}
            </span>
          ) : (
            <span>{t('search.footerShortcuts')}</span>
          )
        }
      />

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

const ACTION_ICONS: Record<PaletteAction, React.ReactNode> = {
  goMyWork: <ArrowRight size={14} strokeWidth={1.5} />,
  goInbox: <ArrowRight size={14} strokeWidth={1.5} />,
  goTeam: <ArrowRight size={14} strokeWidth={1.5} />,
  goProjects: <ArrowRight size={14} strokeWidth={1.5} />,
  goSearch: <ArrowRight size={14} strokeWidth={1.5} />,
  newProject: <FolderOpen size={14} strokeWidth={1.5} />,
  assignToMe: <UserPlus size={14} strokeWidth={1.5} />,
  switchLanguage: <Languages size={14} strokeWidth={1.5} />,
  toggleTheme: <SunMoon size={14} strokeWidth={1.5} />,
};

/**
 * Is this event coming from somewhere a person is typing?
 *
 * The single most important line in the shortcut path. `/` inside a comment
 * composer has to be a slash and `g` inside a title has to be a g, or the
 * product becomes unusable the moment somebody writes a sentence — and §7.7 is
 * emphatic that typed text is never lost.
 *
 * `isContentEditable` covers the rich-text surfaces a later slice may add;
 * `closest` covers a click target *inside* one.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.closest('[contenteditable="true"]') !== null;
}
