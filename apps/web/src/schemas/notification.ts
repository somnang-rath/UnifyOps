export type NotifType =
  | 'issue'
  | 'mr'
  | 'mention'
  | 'done'
  | 'issue_assigned'
  | 'issue_status'
  | 'issue_commented'
  | 'mr_review'
  | 'mr_decided'
  | 'mr_commented'
  | 'wiki_mention'
  | 'note_shared'
  | 'project_member'
  | 'due_soon';

export type EntityKind =
  | 'issue'
  | 'mr'
  | 'comment'
  | 'project'
  | 'wiki'
  | 'note';

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface Notification {
  _id: string;
  type: NotifType;
  title: string;
  subject: string;
  link?: string;
  read: boolean;
  count?: number;
  actorId?: string;
  actorIds?: string[];
  entityRef?: EntityRef;
  createdAt: string;
  updatedAt?: string;
}

export interface NotifResp {
  items: Notification[];
  unread: number;
}

export interface Badges {
  issues: number;
  mywork: number;
  approvals: number;
  notifications: number;
}
