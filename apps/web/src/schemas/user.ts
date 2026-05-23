import type { AuthUser } from './auth';

export interface DirectoryUser extends AuthUser {
  _id: string;
  projectCount: number;
  issueCount: number;
  createdAt: string;
  blocked?: boolean;
  invitePending?: boolean;
}

export interface UserLite {
  _id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}
