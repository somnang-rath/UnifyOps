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
import type { NoteBlockType } from '@/schemas/note';

/**
 * Slash-menu options for the legacy BlockEditor. Notes moved to the
 * collaborative editor (ADR 0009); the block editor now lives only here for
 * the project overview doc, which still stores `NoteBlock[]`.
 */
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
