/**
 * The workspace payload as shaped by the API's `WorkspacesService.shape()`.
 * Note it uses `id` (not `_id`) — unlike Project, which is returned lean from
 * Mongo. Mirrors `WorkspaceRow` in apps/admin's useInstance.ts.
 */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  desc: string;
  color: string;
  owner: { id: string; name?: string; email?: string } | null;
  memberCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}
