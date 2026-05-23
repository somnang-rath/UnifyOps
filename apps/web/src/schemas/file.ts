export type FileCategory = 'image' | 'pdf' | 'doc' | 'link' | 'other';

export type GrantLevel = 'none' | 'read' | 'upload' | 'edit';
export type AccessLevel = GrantLevel | 'owner';
export type GrantRole = 'admin' | 'cpo' | 'marketing' | 'sales' | 'dev';

/**
 * A grant targets either a user or a role — exactly one of `userId` / `role`
 * is non-null. When the grant is by user, `user` is hydrated by the API.
 */
export interface FolderGrant {
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

export interface Folder {
  _id: string;
  name: string;
  parentId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  /** Annotated by the backend on list responses. */
  _access?: AccessLevel;
  _isShared?: boolean;
}

export interface FileItem {
  _id: string;
  name: string;
  mimeType: string;
  size: number;
  category: FileCategory;
  folderId: string | null;
  ownerId: string;
  url?: string;
  storageKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FileStats {
  files: number;
  size: number;
  folders: number;
}
