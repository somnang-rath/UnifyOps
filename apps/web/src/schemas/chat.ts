// Client-side mirror of the chat API contract (apps/api chat module). Only apps/web
// consumes chat in v1, so these live here rather than in packages/types (ADR 0007).

export type ChannelKind = 'channel' | 'dm';
export type ChannelVisibility = 'public' | 'private';
export type MessageSource = 'prism' | 'telegram';

export interface ChannelView {
  _id: string;
  workspaceId: string;
  kind: ChannelKind;
  name: string;
  slug?: string;
  topic: string;
  visibility: ChannelVisibility;
  archived: boolean;
  memberIds: string[];
  isMember: boolean;
  lastMessageAt: string;
  lastMessagePreview: string;
  messageCount: number;
  unreadCount: number;
  unreadMentionCount: number;
  muted: boolean;
  telegram: { linked: boolean; active: boolean; chatTitle: string } | null;
  peer?: { _id: string; name: string; avatar?: string };
}

export interface MessageView {
  _id: string;
  channelId: string;
  body: string;
  kind: 'user' | 'system';
  source: MessageSource;
  clientId?: string;
  author: { _id: string; name: string; avatar?: string } | null;
  externalAuthor?: { name: string; username?: string };
  attachments: { fileId: string; name: string; mime: string; size: number }[];
  reactions: { emoji: string; userIds: string[] }[];
  mentions: string[];
  replyToId?: string;
  editedAt?: string;
  deleted: boolean;
  createdAt: string;
}

export interface MessagePage {
  items: MessageView[];
  nextCursor: string | null;
}

export interface TelegramLinkStatus {
  linked: boolean;
  active: boolean;
  direction: 'both' | 'to-telegram' | 'from-telegram';
  chatTitle: string;
  chatId: string | null;
  pendingCode: string | null;
  pendingCodeExpiresAt: string | null;
  botUsername: string | null;
  lastError: string | null;
}

// Socket event payloads (server → client on /ws/chat).
export interface UnreadEvent {
  channelId: string;
  unreadCount: number;
  unreadMentionCount: number;
  preview: string;
}

export interface TypingEvent {
  channelId: string;
  userId: string;
  name: string;
}

export interface MessageDeleteEvent {
  channelId: string;
  messageId: string;
}

export interface TelegramStatusEvent {
  channelId: string;
  linked: boolean;
  active: boolean;
  chatTitle: string;
}
