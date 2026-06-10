'use client';
import { useState } from 'react';
import type { ReportElementType } from '@/schemas/report';
import {
  BarChart2,
  Hash,
  Heading1,
  ImageIcon,
  Minus,
  Square,
  Table2,
  Layers,
  TrendingUp,
  Type,
  GaugeCircle,
} from 'lucide-react';

interface ElementDef {
  type: ReportElementType;
  label: string;
  icon: React.ReactNode;
  defaultProps: Record<string, unknown>;
  defaultSize: { w: number; h: number };
}

const ELEMENTS: ElementDef[] = [
  {
    type: 'text',
    label: 'Text',
    icon: <Type className="w-4 h-4" />,
    defaultProps: { content: 'Your text here', fontSize: 14, color: '#111111' },
    defaultSize: { w: 200, h: 60 },
  },
  {
    type: 'heading',
    label: 'Heading',
    icon: <Heading1 className="w-4 h-4" />,
    defaultProps: { content: 'Report Title', fontSize: 28, color: '#111111' },
    defaultSize: { w: 400, h: 50 },
  },
  {
    type: 'image',
    label: 'Image',
    icon: <ImageIcon className="w-4 h-4" />,
    defaultProps: { src: '', objectFit: 'cover' },
    defaultSize: { w: 200, h: 150 },
  },
  {
    type: 'grouped-table',
    label: 'Grouped Table',
    icon: <Layers className="w-4 h-4" />,
    defaultProps: {
      groupByField:  'company_kh',
      subGroupField: 'site_kh',
      detailField:   'chargers_detail',
      outerBorder:   true,
      showColBorders: true,
      showRowBorders: true,
    },
    defaultSize: { w: 600, h: 300 },
  },
  {
    type: 'table',
    label: 'Table',
    icon: <Table2 className="w-4 h-4" />,
    defaultProps: {
      columns: ['Column 1', 'Column 2', 'Column 3'],
      rows: [
        { 'Column 1': 'Cell A1', 'Column 2': 'Cell B1', 'Column 3': 'Cell C1' },
        { 'Column 1': 'Cell A2', 'Column 2': 'Cell B2', 'Column 3': 'Cell C2' },
      ],
      autoPageBreak: false,
      autoHeight: true,
      repeatHeader: true,
    },
    defaultSize: { w: 350, h: 120 },
  },
  {
    type: 'shape',
    label: 'Shape',
    icon: <Square className="w-4 h-4" />,
    defaultProps: { shape: 'rect', fill: '#6366f1', borderRadius: '4px' },
    defaultSize: { w: 120, h: 60 },
  },
  {
    type: 'data-widget',
    label: 'Widget',
    icon: <BarChart2 className="w-4 h-4" />,
    defaultProps: {
      kpiLabel: 'My Metric',
      kpiValue: '0',
    },
    defaultSize: { w: 200, h: 120 },
  },
  {
    type: 'chart',
    label: 'Chart',
    icon: <TrendingUp className="w-4 h-4" />,
    defaultProps: {
      chartType: 'bar',
      seriesData: [
        { name: 'Category A', value: 40, color: '#6366f1' },
        { name: 'Category B', value: 55, color: '#f59e0b' },
        { name: 'Category C', value: 30, color: '#22c55e' },
        { name: 'Category D', value: 72, color: '#ef4444' },
      ],
    },
    defaultSize: { w: 300, h: 200 },
  },
  {
    type: 'progress-bar',
    label: 'Progress',
    icon: <GaugeCircle className="w-4 h-4" />,
    defaultProps: {
      label: 'Completion',
      value: 65,
      maxValue: 100,
      color: '#6366f1',
      barHeight: 12,
      showValue: true,
      rounded: true,
    },
    defaultSize: { w: 280, h: 56 },
  },
  {
    type: 'divider',
    label: 'Divider',
    icon: <Minus className="w-4 h-4" />,
    defaultProps: { color: '#e5e7eb', thickness: 1 },
    defaultSize: { w: 400, h: 10 },
  },
  {
    type: 'page-number',
    label: 'Page No.',
    icon: <Hash className="w-4 h-4" />,
    defaultProps: { fontSize: 11, color: '#9ca3af', format: 'page', align: 'center' },
    defaultSize: { w: 80, h: 24 },
  },
];

export { ELEMENTS };
export type { ElementDef };

interface Props {
  onAdd: (def: ElementDef) => void;
}

export function ElementsSidebar({ onAdd }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="w-[60px] bg-bg-card border-r border-border flex flex-col items-center py-3 gap-0.5 select-none flex-shrink-0">
      <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5 px-1 text-center">
        Add
      </p>

      {ELEMENTS.map((el) => (
        <button
          key={el.type}
          onClick={() => onAdd(el)}
          onMouseEnter={() => setHovered(el.type)}
          onMouseLeave={() => setHovered(null)}
          className="relative w-11 h-11 flex flex-col items-center justify-center rounded-lg hover:bg-accent-100 hover:text-accent-700 active:scale-95 transition-all duration-100 text-text-muted gap-0.5 group"
          title={el.label}
        >
          {el.icon}
          <span className="text-[9px] leading-none font-medium">{el.label.split(' ')[0]}</span>

          {/* Tooltip */}
          {hovered === el.type && (
            <div className="absolute left-[calc(100%+8px)] top-1/2 -translate-y-1/2 bg-bg-card border border-border rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap z-50 shadow-lg pointer-events-none">
              <span className="font-medium text-text">{el.label}</span>
              {/* Arrow */}
              <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-border" />
              <div className="absolute right-[calc(100%-1px)] top-1/2 -translate-y-1/2 border-4 border-transparent border-r-bg-card" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
