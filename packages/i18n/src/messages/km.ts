import type { MessageKey } from './en';
import type { Message } from '../translator';

/**
 * Khmer messages.
 *
 * The `Record<MessageKey, Message>` annotation is the whole point of the flat
 * key map: leave a key out and this file does not compile (ADR 0016 §5.6). A
 * key that is present but *identical to English* is fine and expected — some
 * product nouns are borrowed as-is in Khmer offices, and pretending otherwise
 * produces translations nobody uses.
 *
 * Plural values still carry `one`/`other` because the type demands both; Khmer
 * has a single form, so both strings are the same and `Intl.PluralRules('km')`
 * never has to choose. That is deliberate — see ADR 0016 §2.4.
 */
export const km: Record<MessageKey, Message> = {
  // ── Sidebar sections ───────────────────────────────────────────────
  'nav.section.workspace': 'កន្លែងធ្វើការ',
  'nav.section.planTrack': 'រៀបចំ និងតាមដាន',
  'nav.section.knowledge': 'ចំណេះដឹង',
  'nav.section.peopleTools': 'មនុស្ស និងឧបករណ៍',

  // ── Sidebar items ──────────────────────────────────────────────────
  'nav.home': 'ទំព័រដើម',
  'nav.myWork': 'ការងាររបស់ខ្ញុំ',
  'nav.projects': 'គម្រោង',
  'nav.chat': 'ជជែក',
  'nav.tasks': 'កិច្ចការ',
  'nav.board': 'ក្ដារ',
  'nav.calendar': 'ប្រតិទិន',
  'nav.approvals': 'ការអនុម័ត',
  'nav.intake': 'សំណើចូល',
  'nav.analytics': 'ការវិភាគ',
  'nav.storage': 'ឯកសារ',
  'nav.wiki': 'វិគី',
  'nav.notes': 'កំណត់ចំណាំ',
  'nav.tables': 'តារាង',
  'nav.reports': 'របាយការណ៍',
  'nav.assistant': 'ជំនួយការ',
  'nav.notifications': 'ការជូនដំណឹង',
  'nav.automations': 'ស្វ័យប្រវត្តិកម្ម',
  'nav.timeline': 'កាលប្បវត្តិ',
  'nav.people': 'បុគ្គលិក',
  'nav.debug': 'កំហុស និងការវិភាគ',
  'nav.settings': 'ការកំណត់',
  'nav.godMode': 'God Mode',
  'nav.quickJump': 'លោតរហ័ស',
  'nav.collapse': 'បង្រួមរបារចំហៀង',
  'nav.expand': 'ពង្រីករបារចំហៀង',

  // ── Shared chrome ──────────────────────────────────────────────────
  'chrome.search': 'ស្វែងរក ឬលោតទៅ…',
  'chrome.commandPalette': 'បញ្ជីពាក្យបញ្ជា',
  'chrome.commands': 'ពាក្យបញ្ជា',
  'chrome.filters': 'តម្រង',
  'chrome.loading': 'កំពុងផ្ទុក',
  'chrome.nothingHere': 'មិនទាន់មានអ្វីនៅឡើយ',
  'chrome.notifications': 'ការជូនដំណឹង',
  'chrome.all': 'ទាំងអស់',
  'chrome.unread': 'មិនទាន់អាន',
  'chrome.mentions': 'ការនិយាយដល់',
  'chrome.workspace': 'កន្លែងធ្វើការ',

  // ── Common actions ─────────────────────────────────────────────────
  'action.save': 'រក្សាទុក',
  'action.cancel': 'បោះបង់',
  'action.delete': 'លុប',
  'action.create': 'បង្កើត',
  'action.edit': 'កែសម្រួល',
  'action.close': 'បិទ',
  'action.retry': 'ព្យាយាមម្ដងទៀត',
  'action.signOut': 'ចាកចេញ',

  // ── Appearance settings ────────────────────────────────────────────
  'settings.appearance.title': 'រូបរាង',
  'settings.language.title': 'ភាសា',
  'settings.language.help':
    'អនុវត្តគ្រប់កន្លែងដែលអ្នកបានចូល។ ទម្រង់កាលបរិច្ឆេទ និងលេខក៏ប្ដូរតាមដែរ។',
  'settings.language.en': 'English',
  'settings.language.km': 'ភាសាខ្មែរ',

  // ── Issues / work items (3b) ───────────────────────────────────────
  'issues.title': 'កិច្ចការ',
  'issues.search': 'ស្វែងរក…',
  'issues.searchAria': 'ស្វែងរកកិច្ចការ',
  'issues.selectAll': 'ជ្រើសរើសកិច្ចការទាំងអស់',
  'issues.import': 'នាំចូល',
  'issues.importAria': 'នាំចូលកិច្ចការពី CSV',
  'issues.empty': 'រកមិនឃើញកិច្ចការទេ',
  'issues.emptyHint': 'សាកល្បងកែតម្រង ឬបង្កើតកិច្ចការថ្មី។',
  'issues.newTask': 'កិច្ចការថ្មី',
  'issues.openedBy': 'បើកដោយ {name} {when}',
  'issues.due': 'ត្រូវរួចរាល់ {date}',
  'issues.group.aria': 'ដាក់ជាក្រុម',
  'issues.group.none': 'មិនដាក់ជាក្រុម',
  'issues.group.priority': 'អាទិភាព',
  'issues.sort.aria': 'តម្រៀប',
  'issues.sort.newest': 'ថ្មីជាងគេ',
  'issues.sort.oldest': 'ចាស់ជាងគេ',
  'issues.sort.dueDate': 'ថ្ងៃកំណត់',
  'issues.filter.allProjects': 'គម្រោងទាំងអស់',
  'issues.filter.allTypes': 'ប្រភេទទាំងអស់',
  'issues.filter.anyPriority': 'អាទិភាពទាំងអស់',
  'issues.filter.open': 'កំពុងបើក',
  'issues.filter.closed': 'បានបិទ',
  'issues.noProject': 'គ្មានគម្រោង',
  'issues.unknownProject': 'គម្រោងមិនស្គាល់',
  'issues.unassigned': 'មិនទាន់ប្រគល់',
  'issues.unknownUser': 'មិនស្គាល់',

  // ── Issue enums ────────────────────────────────────────────────────
  'issue.type.bug': 'កំហុស',
  'issue.type.feature': 'មុខងារ',
  'issue.type.task': 'កិច្ចការ',
  'issue.type.docs': 'ឯកសារ',
  'issue.priority.low': 'ទាប',
  'issue.priority.medium': 'មធ្យម',
  'issue.priority.high': 'ខ្ពស់',
  'issue.priority.critical': 'បន្ទាន់',
  'issue.status.todo': 'ត្រូវធ្វើ',
  'issue.status.inprogress': 'កំពុងធ្វើ',
  'issue.status.review': 'ត្រួតពិនិត្យ',
  'issue.status.done': 'រួចរាល់',
  'issues.group.status': 'ក្រុម៖ ស្ថានភាព',
  'issues.group.priorityBy': 'ក្រុម៖ អាទិភាព',
  'issues.group.project': 'ក្រុម៖ គម្រោង',
  'issues.group.assignee': 'ក្រុម៖ អ្នកទទួលបន្ទុក',
  'issues.tab.all': 'ទាំងអស់',

  // ── Projects (3b) ──────────────────────────────────────────────────
  'projects.title': 'គម្រោង',
  'projects.new': 'គម្រោងថ្មី',
  'projects.search': 'ស្វែងរកគម្រោង…',
  'projects.searchAria': 'ស្វែងរកគម្រោង',
  'projects.empty': 'មិនទាន់មានគម្រោងទេ',
  'projects.emptySearch': 'គ្មានគម្រោងត្រូវនឹងការស្វែងរករបស់អ្នក',
  'projects.emptyHint': 'ចាប់ផ្ដើមគម្រោងដំបូងរបស់អ្នក ដើម្បីរៀបចំការងារ។',
  'projects.emptySearchHint': 'សាកល្បងពាក្យផ្សេង ឬសម្អាតតម្រង។',
  'projects.noDescription': 'គ្មានការពិពណ៌នា',
  'projects.sort.alphabetical': 'តាមអក្ខរក្រម',
  'projects.sort.recentlyUpdated': 'ធ្វើបច្ចុប្បន្នភាពថ្មីៗ',
  'projects.sort.mostActive': 'សកម្មជាងគេ',
  'projects.layout.grid': 'ប្លង់ក្រឡា',
  'projects.layout.list': 'ប្លង់បញ្ជី',
  'projects.members': 'សមាជិក',
  'projects.createdOn': 'បង្កើតនៅ {date}',

  // ── Cycles & modules (3b) ──────────────────────────────────────────
  'cycles.status.draft': 'ព្រាង',
  'cycles.status.upcoming': 'នឹងមកដល់',
  'cycles.status.current': 'កំពុងដំណើរការ',
  'cycles.status.completed': 'បានបញ្ចប់',
  'cycles.group.drafts': 'ព្រាង',
  'cycles.group.upcoming': 'នឹងមកដល់',
  'cycles.group.active': 'កំពុងដំណើរការ',
  'cycles.group.completed': 'បានបញ្ចប់',
  'cycles.empty': 'មិនទាន់មានវដ្តទេ',
  'cycles.notScheduled': 'មិនទាន់កំណត់ពេល',
  'cycles.endsToday': 'បញ្ចប់ថ្ងៃនេះ',
  'cycles.daysLeft': { one: 'នៅសល់ {count} ថ្ងៃ', other: 'នៅសល់ {count} ថ្ងៃ' },
  'cycles.done': 'រួចរាល់ {completed}/{total}',
  'cycles.noItems': 'មិនទាន់មានកិច្ចការក្នុងវដ្តនេះទេ។',
  'modules.status.backlog': 'បញ្ជីរង់ចាំ',
  'modules.status.planned': 'បានគ្រោងទុក',
  'modules.status.inProgress': 'កំពុងដំណើរការ',
  'modules.status.paused': 'បានផ្អាក',
  'modules.status.completed': 'បានបញ្ចប់',
  'modules.status.cancelled': 'បានលុបចោល',
  'modules.noItems': 'មិនទាន់មានកិច្ចការក្នុងម៉ូឌុលនេះទេ។',
  'modules.from': 'ចាប់ពី {date}',
  'modules.target': 'គោលដៅ {date}',

  // ── Cycle capacity, holiday-aware (3c) ─────────────────────────────
  'capacity.workingDays': {
    one: 'ថ្ងៃធ្វើការ {count} ថ្ងៃ',
    other: 'ថ្ងៃធ្វើការ {count} ថ្ងៃ',
  },
  'capacity.approx': 'ប្រហាក់ប្រហែល',
  'capacity.holidaysLost': {
    one: '−{count} ថ្ងៃឈប់សម្រាក',
    other: '−{count} ថ្ងៃឈប់សម្រាក',
  },
  'capacity.detail': 'ថ្ងៃធ្វើការ {working} ថ្ងៃ ក្នុងចំណោម {calendar} ថ្ងៃប្រតិទិន',
  'capacity.detail.holidays': 'ថ្ងៃឈប់សម្រាកជាតិ៖ {names}',
  'capacity.detail.unknownYear':
    'គ្មានទិន្នន័យថ្ងៃឈប់សម្រាកសម្រាប់ឆ្នាំនេះទេ ដូច្នេះលេខនេះខ្ពស់ជាងការពិត។',
  'capacity.detail.provisional':
    'កាលបរិច្ឆេទបុណ្យតាមចន្ទគតិនៅជាបណ្ដោះអាសន្ន រង់ចាំអនុក្រឹត្យផ្លូវការ។',

  // ── Plurals: one form in Khmer, both slots the same on purpose ─────
  'count.issues': { one: 'កិច្ចការ {count}', other: 'កិច្ចការ {count}' },
  'count.projects': { one: 'គម្រោង {count}', other: 'គម្រោង {count}' },
  'count.members': { one: 'សមាជិក {count}', other: 'សមាជិក {count}' },
  'count.unread': { one: 'មិនទាន់អាន {count}', other: 'មិនទាន់អាន {count}' },
};
