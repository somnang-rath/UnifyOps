export interface DashboardIssue {
  _id: string;
  title: string;
  status: string;
  priority: 'low' | 'medium' | 'high' | 'critical' | 'urgent';
  projectId: string;
  assigneeId?: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardActivity {
  _id: string;
  actorId: string;
  actorName: string;
  actorAvatar?: string;
  action: string;
  title: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface AdminTeamStat {
  id: string;
  name: string;
  avatar?: string;
  open: number;
  overdue: number;
  done: number;
}

export interface DashboardOverview {
  kpi: {
    myOpen: number;
    overdue: number;
    dueToday: number;
    doneWeek: number;
    projects: number;
    approvals?: number;
  };
  myWork: DashboardIssue[];
  upcoming: DashboardIssue[];
  progress: {
    done: number;
    inProgress: number;
    todo: number;
    total: number;
  };
  projectStats: Array<{
    id: string;
    name: string;
    color: string;
    members: string[];
    done: number;
    total: number;
    overdue: number;
  }>;
  activity: DashboardActivity[];
  adminStats?: {
    totalUsers: number;
    teamStats: AdminTeamStat[];
  };
}
