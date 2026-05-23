export type NoteBlockType =
  | 'text'
  | 'heading'
  | 'check'
  | 'code'
  | 'image'
  | 'video'
  | 'divider'
  | 'table'
  | 'file';

export interface TableData {
  cols: number;
  rows: string[][];
  headerRow?: boolean;
}

export interface NoteBlock {
  type: NoteBlockType;
  value: string;
  checked?: boolean;
  lang?: string;
  color?: string;
  table?: TableData;
  fileId?: string;
  fileViewSize?: 'sm' | 'md' | 'lg';
}

export interface Note {
  _id: string;
  ownerId: string;
  folderId: string | null;
  title: string;
  emoji: string;
  blocks: NoteBlock[];
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type GrantLevel = 'none' | 'read' | 'upload' | 'edit';
export type AccessLevel = GrantLevel | 'owner';
export type GrantRole = 'admin' | 'cpo' | 'marketing' | 'sales' | 'dev';

export interface NoteFolderGrant {
  userId: string | null;
  role: GrantRole | null;
  level: GrantLevel;
  user: {
    _id: string;
    id: string;
    name: string;
    email: string;
    avatar?: string;
    role: string;
  } | null;
}

export interface NoteFolder {
  _id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  /** Annotated by the backend on list responses. */
  _access?: AccessLevel;
  _isShared?: boolean;
}
