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
}
