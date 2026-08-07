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

  // ── Issues / work items (3b) ───────────────────────────────────────
  'issues.title': 'Tasks',
  'issues.search': 'Search…',
  'issues.searchAria': 'Search tasks',
  'issues.selectAll': 'Select all tasks',
  'issues.import': 'Import',
  'issues.importAria': 'Import work items from CSV',
  'issues.empty': 'No tasks found',
  'issues.emptyHint': 'Try adjusting your filters or create a new one.',
  'issues.newTask': 'New task',
  'issues.openedBy': 'opened {when} by {name}',
  'issues.due': 'Due {date}',
  'issues.group.aria': 'Group',
  'issues.group.none': 'No grouping',
  'issues.group.priority': 'Priority',
  'issues.sort.aria': 'Sort',
  'issues.sort.newest': 'Newest',
  'issues.sort.oldest': 'Oldest',
  'issues.sort.dueDate': 'Due date',
  'issues.filter.allProjects': 'All projects',
  'issues.filter.allTypes': 'All types',
  'issues.filter.anyPriority': 'Any priority',
  'issues.filter.open': 'Open',
  'issues.filter.closed': 'Closed',
  'issues.noProject': 'No project',
  'issues.unknownProject': 'Unknown project',
  'issues.unassigned': 'Unassigned',
  'issues.unknownUser': 'Unknown',

  // ── Issue enums: rendered on every list, board and filter ──────────
  'issue.type.bug': 'Bug',
  'issue.type.feature': 'Feature',
  'issue.type.task': 'Task',
  'issue.type.docs': 'Docs',
  'issue.priority.low': 'Low',
  'issue.priority.medium': 'Medium',
  'issue.priority.high': 'High',
  'issue.priority.critical': 'Critical',
  'issue.status.todo': 'To do',
  'issue.status.inprogress': 'In progress',
  'issue.status.review': 'Review',
  'issue.status.done': 'Done',
  'issues.group.status': 'Group: status',
  'issues.group.priorityBy': 'Group: priority',
  'issues.group.project': 'Group: project',
  'issues.group.assignee': 'Group: assignee',
  'issues.tab.all': 'All',

  // ── Projects (3b) ──────────────────────────────────────────────────
  'projects.title': 'Projects',
  'projects.new': 'New project',
  'projects.search': 'Search projects…',
  'projects.searchAria': 'Search projects',
  'projects.empty': 'No projects yet',
  'projects.emptySearch': 'No projects match your search',
  'projects.emptyHint': 'Start your first project to organize your work.',
  'projects.emptySearchHint': 'Try a different keyword, or clear the filter.',
  'projects.noDescription': 'No description',
  'projects.sort.alphabetical': 'Alphabetical',
  'projects.sort.recentlyUpdated': 'Recently updated',
  'projects.sort.mostActive': 'Most active',
  'projects.layout.grid': 'Grid layout',
  'projects.layout.list': 'List layout',
  'projects.members': 'Members',
  'projects.createdOn': 'Created {date}',

  // ── Cycles & modules (3b) ──────────────────────────────────────────
  'cycles.status.draft': 'Draft',
  'cycles.status.upcoming': 'Upcoming',
  'cycles.status.current': 'Active',
  'cycles.status.completed': 'Completed',
  'cycles.group.drafts': 'Drafts',
  'cycles.group.upcoming': 'Upcoming',
  'cycles.group.active': 'Active',
  'cycles.group.completed': 'Completed',
  'cycles.empty': 'No cycles yet',
  'cycles.notScheduled': 'Not scheduled',
  'cycles.endsToday': 'Ends today',
  'cycles.daysLeft': { one: '{count} day left', other: '{count} days left' },
  'cycles.done': '{completed}/{total} done',
  'cycles.noItems': 'No work items in this cycle yet.',
  'modules.status.backlog': 'Backlog',
  'modules.status.planned': 'Planned',
  'modules.status.inProgress': 'In progress',
  'modules.status.paused': 'Paused',
  'modules.status.completed': 'Completed',
  'modules.status.cancelled': 'Cancelled',
  'modules.noItems': 'No work items in this module yet.',
  'modules.from': 'From {date}',
  'modules.target': 'Target {date}',

  // ── Cycle capacity, holiday-aware (3c) ─────────────────────────────
  'capacity.workingDays': {
    one: '{count} working day',
    other: '{count} working days',
  },
  /** Appended when the holiday table has no entry for the cycle's year. */
  'capacity.approx': 'approx.',
  'capacity.holidaysLost': {
    one: '−{count} holiday',
    other: '−{count} holidays',
  },
  'capacity.detail': '{working} working days of {calendar} calendar days',
  'capacity.detail.holidays': 'Public holidays: {names}',
  'capacity.detail.unknownYear':
    'No public-holiday data for this year, so this is an over-estimate.',
  'capacity.detail.provisional':
    'Lunar holiday dates are provisional pending the official sub-decree.',

  // ── Plurals: the shape exists for English, not for Khmer ───────────
  'count.issues': { one: '{count} issue', other: '{count} issues' },
  'count.projects': { one: '{count} project', other: '{count} projects' },
  'count.members': { one: '{count} member', other: '{count} members' },
  'count.unread': { one: '{count} unread', other: '{count} unread' },
} as const;

export type MessageKey = keyof typeof en;
