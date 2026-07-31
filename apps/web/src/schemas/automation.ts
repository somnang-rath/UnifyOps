export interface Automation {
  _id: string;
  /** The tenant the rule belongs to and the only one its events can come from. */
  workspaceId: string;
  /** Who created it — the read scope is the workspace, not this. */
  ownerId: string;
  name: string;
  trigger: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  enabled: boolean;
  lastFired?: string;
  timesFired: number;
  createdAt: string;
  updatedAt: string;
}

export const AU_TRIGGERS: { value: string; label: string; desc: string }[] = [
  { value: 'issue.created', label: 'Task created', desc: 'Fires whenever a new task is opened' },
  { value: 'issue.status_changed', label: 'Task status changed', desc: 'Fires when a task moves to a new status' },
  { value: 'issue.assigned', label: 'Task assigned', desc: 'Fires when a task gets an assignee' },
  { value: 'issue.due_soon', label: 'Task due soon', desc: 'Fires the day before a task is due' },
  { value: 'mr.opened', label: 'Approval request opened', desc: 'Fires when a new merge request is created' },
  { value: 'mr.merged', label: 'Approval request merged', desc: 'Fires when a merge request is accepted' },
  { value: 'project.member_added', label: 'Member added to project', desc: 'Fires when someone joins a project' },
];

export const AU_ACTIONS: { value: string; label: string; desc: string }[] = [
  { value: 'notify', label: 'Send notification', desc: 'Push an in-app notification to a user or role' },
  { value: 'set_status', label: 'Set task status', desc: 'Automatically update the task status' },
  { value: 'set_assignee', label: 'Set assignee', desc: 'Assign the task to a specific user' },
  { value: 'add_label', label: 'Add label', desc: 'Apply a label tag to the task' },
  { value: 'webhook', label: 'Call webhook', desc: 'POST a JSON payload to an external URL' },
];
