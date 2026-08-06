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

  // ── Plurals: one form in Khmer, both slots the same on purpose ─────
  'count.issues': { one: 'កិច្ចការ {count}', other: 'កិច្ចការ {count}' },
  'count.projects': { one: 'គម្រោង {count}', other: 'គម្រោង {count}' },
  'count.members': { one: 'សមាជិក {count}', other: 'សមាជិក {count}' },
  'count.unread': { one: 'មិនទាន់អាន {count}', other: 'មិនទាន់អាន {count}' },
};
