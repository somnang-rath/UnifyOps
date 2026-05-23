export const KB_BOARDS_BY_ROLE = {
  product: [
    { id: 'todo',       name: 'Backlog',     color: 'slate',  collapsed: false },
    { id: 'design',     name: 'In Design',   color: 'purple', collapsed: false },
    { id: 'inprogress', name: 'Development', color: 'amber',  collapsed: false },
    { id: 'review',     name: 'QA / Review', color: 'blue',   collapsed: false },
    { id: 'done',       name: 'Released',    color: 'green',  collapsed: false },
  ],
  marketing: [
    { id: 'todo',       name: 'Drafting',         color: 'slate',  collapsed: false },
    { id: 'inprogress', name: 'In Progress',      color: 'amber',  collapsed: false },
    { id: 'review',     name: 'In Review',        color: 'blue',   collapsed: false },
    { id: 'ready',      name: 'Ready to Publish', color: 'purple', collapsed: false },
    { id: 'done',       name: 'Published',        color: 'pink',   collapsed: false },
  ],
  sales: [
    { id: 'todo',       name: 'Prospecting',   color: 'slate',  collapsed: false },
    { id: 'discovery',  name: 'Discovery',     color: 'indigo', collapsed: false },
    { id: 'inprogress', name: 'Proposal Sent', color: 'amber',  collapsed: false },
    { id: 'review',     name: 'Negotiation',   color: 'purple', collapsed: false },
    { id: 'done',       name: 'Closed Won',    color: 'green',  collapsed: false },
  ],
  admin: [
    { id: 'todo',       name: 'Open',        color: 'slate', collapsed: false },
    { id: 'inprogress', name: 'In Progress', color: 'amber', collapsed: false },
    { id: 'review',     name: 'Waiting',     color: 'blue',  collapsed: false },
    { id: 'done',       name: 'Completed',   color: 'green', collapsed: false },
  ],
  default: [
    { id: 'todo',       name: 'Backlog',     color: 'slate', builtin: true, collapsed: false },
    { id: 'inprogress', name: 'In progress', color: 'amber', builtin: true, collapsed: false },
    { id: 'review',     name: 'In review',   color: 'blue',  builtin: true, collapsed: false },
    { id: 'done',       name: 'Done',        color: 'green', builtin: true, collapsed: false },
  ],
} as const;

export type BoardRole = keyof typeof KB_BOARDS_BY_ROLE;

export const inferBoardRole = (email: string): BoardRole => {
  const e = email.toLowerCase();
  if (e.includes('cpo') || e.includes('product')) return 'product';
  if (e.includes('marketing') || e.includes('mkt')) return 'marketing';
  if (e.includes('sales')) return 'sales';
  if (e.includes('admin') || e.includes('ops') || e.includes('hr')) return 'admin';
  return 'default';
};
