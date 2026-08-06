/**
 * English messages — the source of truth for the key set (ADR 0016 §2.3).
 *
 * Flat dotted keys, not nested objects: a flat map is what makes
 * `Record<keyof typeof en, …>` in `km.ts` a *complete* obligation, so a missing
 * Khmer translation is a compile error rather than a silent `undefined`.
 *
 * A value is either a string or a plural form. Only use the plural shape when
 * English actually inflects — Khmer has one form for both, which is exactly the
 * kind of thing `Intl.PluralRules` knows and we should not encode by hand.
 */
export const en = {
  // ── Sidebar sections ───────────────────────────────────────────────
  'nav.section.workspace': 'Workspace',
  'nav.section.planTrack': 'Plan & Track',
  'nav.section.knowledge': 'Knowledge',
  'nav.section.peopleTools': 'People & Tools',

  // ── Sidebar items ──────────────────────────────────────────────────
  'nav.home': 'Home',
  'nav.myWork': 'My Work',
  'nav.projects': 'Projects',
  'nav.chat': 'Chat',
  'nav.tasks': 'Tasks',
  'nav.board': 'Board',
  'nav.calendar': 'Calendar',
  'nav.approvals': 'Approvals',
  'nav.intake': 'Intake',
  'nav.analytics': 'Analytics',
  'nav.storage': 'Storage',
  'nav.wiki': 'Wiki',
  'nav.notes': 'Notes',
  'nav.tables': 'Tables',
  'nav.reports': 'Reports',
  'nav.assistant': 'Assistant',
  'nav.notifications': 'Notifications',
  'nav.automations': 'Automations',
  'nav.timeline': 'Timeline',
  'nav.people': 'People',
  'nav.debug': 'Debug & Errors',
  'nav.settings': 'Settings',
  'nav.godMode': 'God Mode',
  'nav.quickJump': 'Quick jump',
  'nav.collapse': 'Collapse sidebar',
  'nav.expand': 'Expand sidebar',

  // ── Shared chrome ──────────────────────────────────────────────────
  'chrome.search': 'Search or jump to…',
  'chrome.commandPalette': 'Command palette',
  'chrome.commands': 'Commands',
  'chrome.filters': 'Filters',
  'chrome.loading': 'Loading',
  'chrome.nothingHere': 'Nothing here yet',
  'chrome.notifications': 'Notifications',
  'chrome.all': 'All',
  'chrome.unread': 'Unread',
  'chrome.mentions': 'Mentions',
  'chrome.workspace': 'Workspace',

  // ── Common actions ─────────────────────────────────────────────────
  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.create': 'Create',
  'action.edit': 'Edit',
  'action.close': 'Close',
  'action.retry': 'Try again',
  'action.signOut': 'Sign out',

  // ── Appearance settings (the locale switcher lives here) ───────────
  'settings.appearance.title': 'Appearance',
  'settings.language.title': 'Language',
  'settings.language.help':
    'Applies everywhere you are signed in. Dates and numbers follow it too.',
  'settings.language.en': 'English',
  'settings.language.km': 'ភាសាខ្មែរ',

  // ── Plurals: the shape exists for English, not for Khmer ───────────
  'count.issues': { one: '{count} issue', other: '{count} issues' },
  'count.projects': { one: '{count} project', other: '{count} projects' },
  'count.members': { one: '{count} member', other: '{count} members' },
  'count.unread': { one: '{count} unread', other: '{count} unread' },
} as const;

export type MessageKey = keyof typeof en;
