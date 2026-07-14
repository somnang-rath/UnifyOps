export interface WikiPageMeta {
  _id: string;
  projectId: string;
  title: string;
  parentId: string | null;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface WikiPage extends WikiPageMeta {
  content: string;
  // Phase 3 — public Space publishing (ADR 0002)
  isPublic?: boolean;
  anchor?: string | null;
  publishedAt?: string | null;
}

// Response of POST /wiki/:id/publish
export interface WikiPublishState {
  anchor: string;
  isPublic: boolean;
  publishedAt: string | null;
}
