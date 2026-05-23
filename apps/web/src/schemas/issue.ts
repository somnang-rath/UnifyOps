import { z } from 'zod';

export const ISSUE_TYPES = ['bug', 'feature', 'task', 'docs'] as const;
export const ISSUE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const ISSUE_STATUSES = ['todo', 'inprogress', 'review', 'done'] as const;

export interface IssueTodo {
  id: string;
  text: string;
  done: boolean;
}

export interface Issue {
  _id: string;
  projectId?: string;
  title: string;
  desc: string;
  type: (typeof ISSUE_TYPES)[number];
  status: string;
  priority: (typeof ISSUE_PRIORITIES)[number];
  assigneeId?: string;
  authorId: string;
  dueDate?: string;
  labels: string[];
  todos?: IssueTodo[];
  comments?: Array<{ authorId: string; body: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface IssueListResponse {
  items: Issue[];
  totals: { open: number; closed: number; all: number };
}

export const IssueFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  desc: z.string().max(10_000).optional().default(''),
  type: z.enum(ISSUE_TYPES),
  status: z.string().min(1),
  priority: z.enum(ISSUE_PRIORITIES),
  projectId: z.string().optional().default(''),
  assigneeId: z.string().optional().default(''),
  dueDate: z.string().optional().default(''),
  labelsRaw: z.string().optional().default(''),
});
export type IssueFormInput = z.infer<typeof IssueFormSchema>;
