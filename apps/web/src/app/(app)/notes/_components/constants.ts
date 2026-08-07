import type { Formatters } from '@prism/i18n';
import type { NoteBlock } from '@/schemas/note';

export const EMOJIS = [
  '📄', '📝', '✨', '💡', '🎯', '🚀', '🔥', '⭐', '📌', '🗂',
  '📚', '🎨', '🌱', '☕', '🧠', '💼', '🎙', '📔', '🧭', '🏆',
  '🌙', '🔮', '🪄', '📎', '🧩', '🏷', '🎵', '🎬', '🧪', '📊',
];

export interface NoteTemplate {
  key: string;
  title: string;
  emoji: string;
  tags: string[];
  blocks: NoteBlock[];
  caption: string;
}

/**
 * A function rather than a `const` because one template's title carries today's
 * date, and a date is locale-dependent (ADR 0016 §2.7). Evaluated at module
 * load it would also have frozen "today" at the moment the tab was opened.
 */
export function buildTemplates(f: Formatters): NoteTemplate[] {
  const today = () => f.date(Date.now());
  return [
  {
    key: 'lesson',
    title: 'Lesson notes',
    emoji: '📚',
    tags: ['lesson', 'study'],
    caption: 'Study & learning',
    blocks: [
      { type: 'heading', value: 'Topic' },
      { type: 'text', value: '' },
      { type: 'heading', value: 'Key points' },
      { type: 'check', value: 'Main idea', checked: false },
      { type: 'check', value: 'Example', checked: false },
      { type: 'heading', value: 'Resources' },
      { type: 'text', value: '' },
    ],
  },
  {
    key: 'meeting',
    title: 'Meeting notes',
    emoji: '🎙',
    tags: ['meeting'],
    caption: 'Agenda & actions',
    blocks: [
      { type: 'heading', value: 'Attendees' },
      { type: 'text', value: '' },
      { type: 'heading', value: 'Agenda' },
      { type: 'check', value: 'Item 1', checked: false },
      { type: 'check', value: 'Item 2', checked: false },
      { type: 'heading', value: 'Action items' },
      { type: 'check', value: '', checked: false },
      { type: 'divider', value: '' },
      { type: 'heading', value: 'Notes' },
      { type: 'text', value: '' },
    ],
  },
  {
    key: 'journal',
    title: `Journal — ${today()}`,
    emoji: '📔',
    tags: ['journal'],
    caption: 'Daily reflection',
    blocks: [
      { type: 'heading', value: 'How I feel today' },
      { type: 'text', value: '' },
      { type: 'heading', value: 'Three wins' },
      { type: 'check', value: '', checked: false },
      { type: 'check', value: '', checked: false },
      { type: 'check', value: '', checked: false },
      { type: 'heading', value: 'Tomorrow' },
      { type: 'text', value: '' },
    ],
  },
  {
    key: 'project',
    title: 'Project docs',
    emoji: '🗂',
    tags: ['project', 'spec'],
    caption: 'Specs & plans',
    blocks: [
      { type: 'heading', value: 'Overview' },
      { type: 'text', value: '' },
      { type: 'heading', value: 'Goals' },
      { type: 'text', value: '' },
      { type: 'heading', value: 'Milestones' },
      { type: 'check', value: 'Phase 1', checked: false },
      { type: 'check', value: 'Phase 2', checked: false },
      { type: 'divider', value: '' },
      { type: 'heading', value: 'Links & references' },
      { type: 'text', value: '' },
    ],
  },
  ];
}

export const AUTOSAVE_MS = 800;

export const blocksPreview = (blocks: NoteBlock[] | undefined) => {
  const first = (blocks || []).find(
    (b) =>
      ['text', 'heading', 'check', 'code'].includes(b.type) && b.value,
  );
  return first ? String(first.value).slice(0, 160) : '';
};

export const readTime = (words: number) =>
  words < 100 ? '< 1 min read' : `${Math.max(1, Math.round(words / 220))} min read`;
