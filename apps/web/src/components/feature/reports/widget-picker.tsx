'use client';
import { useState } from 'react';
import { DATA_WIDGET_CATALOG, type DataWidgetType } from '@/schemas/report';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  BarChart2,
  Calendar,
  CheckCircle2,
  CircleDot,
  FolderOpen,
  Hash,
  LayoutList,
  PieChart,
  Table2,
  TrendingUp,
  Users,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (type: DataWidgetType, isChart: boolean) => void;
}

const CATEGORIES = ['Issues', 'Projects', 'Users', 'General'];

const CAT_ICONS: Record<string, React.ReactNode> = {
  Issues:   <CircleDot className="w-3.5 h-3.5" />,
  Projects: <FolderOpen className="w-3.5 h-3.5" />,
  Users:    <Users className="w-3.5 h-3.5" />,
  General:  <Calendar className="w-3.5 h-3.5" />,
};

const WIDGET_ICONS: Record<DataWidgetType, React.ReactNode> = {
  issues_total:       <Hash className="w-5 h-5" />,
  issues_open:        <CircleDot className="w-5 h-5" />,
  issues_done:        <CheckCircle2 className="w-5 h-5" />,
  issues_overdue:     <AlertTriangle className="w-5 h-5" />,
  issues_by_status:   <BarChart2 className="w-5 h-5" />,
  issues_table:       <Table2 className="w-5 h-5" />,
  projects_total:     <FolderOpen className="w-5 h-5" />,
  projects_list:      <LayoutList className="w-5 h-5" />,
  users_total:        <Users className="w-5 h-5" />,
  users_by_department:<PieChart className="w-5 h-5" />,
  date_label:         <Calendar className="w-5 h-5" />,
};

const CHART_COMPATIBLE: DataWidgetType[] = [
  'issues_by_status', 'users_by_department',
];

export function WidgetPicker({ open, onClose, onPick }: Props) {
  const [selectedType, setSelectedType] = useState<DataWidgetType | null>(null);
  const [asChart, setAsChart] = useState(false);
  const [category, setCategory] = useState('Issues');

  const items = DATA_WIDGET_CATALOG.filter((c) => c.category === category);
  const canChart = selectedType ? CHART_COMPATIBLE.includes(selectedType) : false;

  const handleAdd = () => {
    if (!selectedType) return;
    onPick(selectedType, asChart && canChart);
    onClose();
    setSelectedType(null);
    setAsChart(false);
  };

  const handleClose = () => {
    onClose();
    setSelectedType(null);
    setAsChart(false);
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add Data Widget" size="md">
      <div className="flex gap-0 h-72 -mx-1">
        {/* Category sidebar */}
        <div className="w-36 border-r border-border pr-3 space-y-0.5 flex-shrink-0">
          {CATEGORIES.map((cat) => {
            const count = DATA_WIDGET_CATALOG.filter((c) => c.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => { setCategory(cat); setSelectedType(null); }}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors flex items-center gap-2',
                  category === cat
                    ? 'bg-accent-100 text-accent-700 font-semibold dark:bg-accent-950/40 dark:text-accent-400'
                    : 'hover:bg-bg-hover text-text-sub',
                )}
              >
                <span className={cn(category === cat ? 'text-accent-600' : 'text-text-muted')}>
                  {CAT_ICONS[cat]}
                </span>
                <span className="flex-1">{cat}</span>
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                  category === cat
                    ? 'bg-accent-200 text-accent-700 dark:bg-accent-900/50'
                    : 'bg-bg-subtle text-text-muted',
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Widget grid */}
        <div className="flex-1 overflow-y-auto pl-3 grid grid-cols-1 gap-1.5 content-start">
          {items.map((item) => {
            const isSelected = selectedType === item.type;
            return (
              <button
                key={item.type}
                onClick={() => { setSelectedType(item.type); setAsChart(false); }}
                className={cn(
                  'w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3',
                  isSelected
                    ? 'border-accent-600 bg-accent-50 dark:bg-accent-950/30 shadow-sm'
                    : 'border-border hover:border-accent-300 hover:bg-bg-hover',
                )}
              >
                {/* Icon */}
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                  isSelected
                    ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/50 dark:text-accent-400'
                    : 'bg-bg-subtle text-text-muted',
                )}>
                  {WIDGET_ICONS[item.type]}
                </div>

                {/* Label + description */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight">{item.label}</div>
                  <div className="text-xs text-text-muted mt-0.5 leading-relaxed">{item.description}</div>
                </div>

                {/* Selected checkmark */}
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-accent-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chart toggle — only shown when widget supports charts */}
      {selectedType && (
        <div className={cn(
          'mt-3 pt-3 border-t border-border transition-all',
        )}>
          {canChart ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-text-sub flex-1">Render as chart instead of number card?</span>
              <div className="flex gap-1">
                {(['widget', 'chart'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setAsChart(mode === 'chart')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                      (mode === 'chart') === asChart
                        ? 'border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-950/30 dark:text-accent-400'
                        : 'border-border text-text-muted hover:text-text',
                    )}
                  >
                    {mode === 'chart' ? <TrendingUp className="w-3 h-3" /> : <BarChart2 className="w-3 h-3" />}
                    {mode === 'widget' ? 'Number card' : 'Chart'}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              This widget renders as a number card. Chart view is available for series data (Issues by Status, Team by Department).
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4">
        <Button variant="ghost" onClick={handleClose}>Cancel</Button>
        <Button variant="primary" onClick={handleAdd} disabled={!selectedType}>
          Add Widget
        </Button>
      </div>
    </Modal>
  );
}
