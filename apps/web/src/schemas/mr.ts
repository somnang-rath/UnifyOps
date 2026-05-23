import { z } from 'zod';

export type MRStatus = 'open' | 'merged' | 'closed';

export interface MergeRequest {
  _id: string;
  title: string;
  desc: string;
  sourceBranch: string;
  targetBranch: string;
  projectId?: string;
  authorId: string;
  reviewerId?: string;
  status: MRStatus;
  decidedAt?: string;
  decidedById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MRListResponse {
  items: MergeRequest[];
  totals: { open: number; merged: number; closed: number; all: number };
}

export const MRFormSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  desc: z.string().max(5_000).optional().default(''),
  sourceBranch: z.string().min(1, 'Reference is required').max(120),
  targetBranch: z.string().min(1).max(120).default('main'),
  projectId: z.string().optional().default(''),
  reviewerId: z.string().optional().default(''),
});
export type MRFormInput = z.infer<typeof MRFormSchema>;
