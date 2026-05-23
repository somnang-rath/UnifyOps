import type { LucideIcon } from 'lucide-react';
import {
  Type,
  Heading1,
  CheckSquare,
  Code,
  Image as ImageIcon,
  Video,
  Minus,
  Table as TableIcon,
  Paperclip,
} from 'lucide-react';
import type { NoteBlock, NoteBlockType } from '@/schemas/note';

export interface SlashOption {
  type: NoteBlockType;
  name: string;
  desc: string;
  keywords: string;
  icon: LucideIcon;
}

export const SLASH_OPTIONS: SlashOption[] = [
  {
    type: 'text',
    name: 'Text',
    desc: 'Plain paragraph',
    keywords: 'text paragraph p',
    icon: Type,
  },
  {
    type: 'heading',
    name: 'Heading',
    desc: 'Large section title',
    keywords: 'heading h1 title large',
    icon: Heading1,
  },
  {
    type: 'check',
    name: 'To-do',
    desc: 'Task with checkbox',
    keywords: 'todo task check',
    icon: CheckSquare,
  },
  {
    type: 'code',
    name: 'Code',
    desc: 'Code snippet',
    keywords: 'code snippet pre',
    icon: Code,
  },
  {
    type: 'image',
    name: 'Image',
    desc: 'Embed image URL',
    keywords: 'image picture photo',
    icon: ImageIcon,
  },
  {
    type: 'video',
    name: 'Video',
    desc: 'YouTube / Vimeo / direct',
    keywords: 'video youtube vimeo',
    icon: Video,
  },
  {
    type: 'divider',
    name: 'Divider',
    desc: 'Visual separator',
    keywords: 'divider hr line break',
    icon: Minus,
  },
  {
    type: 'table',
    name: 'Table',
    desc: 'Editable grid',
    keywords: 'table grid sheet rows cols',
    icon: TableIcon,
  },
  {
    type: 'file',
    name: 'File',
    desc: 'Upload or embed a file (PDF, doc…)',
    keywords: 'file pdf attachment doc upload',
    icon: Paperclip,
  },
];

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

const today = () =>
  new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export const TEMPLATES: NoteTemplate[] = [
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

export const AUTOSAVE_MS = 800;

export const blocksPreview = (blocks: NoteBlock[] | undefined) => {
  const first = (blocks || []).find(
    (b) =>
      ['text', 'heading', 'check', 'code'].includes(b.type) && b.value,
  );
  return first ? String(first.value).slice(0, 160) : '';
};

export const videoEmbedURL = (url: string) => {
  if (!url) return '';
  const m1 = url.match(/youtube\.com\/watch\?v=([\w-]+)/);
  if (m1) return `https://www.youtube.com/embed/${m1[1]}`;
  const m2 = url.match(/youtu\.be\/([\w-]+)/);
  if (m2) return `https://www.youtube.com/embed/${m2[1]}`;
  const m3 = url.match(/vimeo\.com\/(\d+)/);
  if (m3) return `https://player.vimeo.com/video/${m3[1]}`;
  return url;
};

export const wordCount = (blocks: NoteBlock[]) => {
  const txt = blocks
    .map((b) => {
      if (['check', 'text', 'heading', 'code'].includes(b.type))
        return String(b.value || '');
      if (b.type === 'table' && b.table)
        return b.table.rows.flat().join(' ');
      return '';
    })
    .join(' ');
  return (txt.trim().match(/\S+/g) || []).length;
};

export const readTime = (words: number) =>
  words < 100 ? '< 1 min read' : `${Math.max(1, Math.round(words / 220))} min read`;
