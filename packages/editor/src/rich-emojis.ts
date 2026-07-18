/**
 * Emoji palette for the RichTextEditor picker. Grouped by category so the
 * picker can render labelled sections (Plane-style). Plain unicode — inserted
 * as text, so it round-trips through markdown untouched.
 */
export interface EmojiCategory {
  name: string;
  emojis: string[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    name: 'Smileys',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂',
      '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩',
      '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝',
      '🤗', '🤭', '🤫', '🤔', '🤨', '😐', '😑', '😶',
      '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '🤤',
      '😴', '😷', '🤒', '🤕', '🥱', '😵', '🤯', '🥳',
      '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯',
      '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥',
      '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩',
      '😫', '😤', '😡', '😠', '🤬', '😈', '👿', '💀',
    ],
  },
  {
    name: 'Gestures',
    emojis: [
      '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟',
      '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋',
      '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '✍️', '💪',
      '👏', '🙌', '👐', '🤲', '🙇', '🤦', '🤷', '💅',
    ],
  },
  {
    name: 'Hearts',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍',
      '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖',
      '💘', '💝', '💯', '💢', '💥', '💫', '💦', '💨',
    ],
  },
  {
    name: 'Objects & Symbols',
    emojis: [
      '🔥', '⭐', '🌟', '✨', '⚡', '☀️', '🌈', '☁️',
      '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🎯', '🚀',
      '✅', '❌', '❓', '❗', '⚠️', '🔔', '📌', '📎',
      '📝', '📅', '📊', '📈', '📉', '💡', '🔒', '🔓',
      '👀', '🧠', '🩹', '🐛', '⏰', '⏳', '💰', '💎',
    ],
  },
];

/** Flat list for quick-access rows / fallbacks. */
export const EMOJI_FLAT: string[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
