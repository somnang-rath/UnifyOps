'use client';

import { useState } from 'react';
import { Loader2, X, FileText, Zap, BarChart2, Activity, BookTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReportElement, ReportTemplate as SavedTemplate } from '@/schemas/report';

// ── Helpers ───────────────────────────────────────────────────────────────────

const uid = () => Math.random().toString(36).slice(2, 9);

function el(
  type: ReportElement['type'],
  x: number, y: number, w: number, h: number,
  props: Record<string, unknown>,
  zIndex = 0,
): ReportElement {
  return { id: uid(), type, x, y, w, h, rotation: 0, zIndex, props };
}

// Card column helpers — 4 equal cards per row inside 734px usable width (margin 30 each side)
const CARD_W = 174;
const CARD_GAP = 12;
const ROW_X = [30, 30 + CARD_W + CARD_GAP, 30 + (CARD_W + CARD_GAP) * 2, 30 + (CARD_W + CARD_GAP) * 3];

// ── Template definitions ──────────────────────────────────────────────────────

export interface ReportTemplate {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  preview: React.ReactNode;
  pageSize: 'A4' | 'Letter' | 'A3';
  orientation: 'portrait' | 'landscape';
  background: string;
  elements: ReportElement[];
}

const EV_CHARGING_ELEMENTS: ReportElement[] = [
  // ─ Header band
  el('heading', 0, 0, 794, 90, {
    content: 'EV Charging Daily Report',
    fontSize: 24, bold: true, color: '#ffffff',
    background: '#2563eb', textAlign: 'center', paddingY: 26,
  }, 0),
  // Sub-header / summary
  el('text', 0, 90, 794, 44, {
    content: 'ទិដ្ឋភាពសង្ខេប: ប្រចាំ 148 ប្រចាំ ផ្ដល់ 3,790 kWh តាម 27 ថ្ងៃ 92 ស្ថានីយ (20 ទីតាំ). MEV Station ចំពោះចំណុច 2,201 kWh.',
    fontSize: 11, color: '#1e40af', background: '#dbeafe', paddingX: 24, paddingY: 12,
  }, 1),

  // ─ OCPP Management section heading
  el('heading', 30, 148, 734, 28, {
    content: 'ស្ថិតិ និងការគ្រប់គ្រប (OCPP)', fontSize: 13, bold: true, color: '#111827',
  }, 2),
  // OCPP stats row: Groups | Stations | Connectors | Charging Points
  el('data-widget', ROW_X[0], 184, CARD_W, 78, { widgetType: 'projects_total',  title: 'ក្រុមហ៊ុន OCPP', colorScheme: '#2563eb' }, 3),
  el('data-widget', ROW_X[1], 184, CARD_W, 78, { widgetType: 'users_total',     title: 'ស្ថានីយ',        colorScheme: '#0891b2' }, 4),
  el('data-widget', ROW_X[2], 184, CARD_W, 78, { widgetType: 'issues_total',    title: 'ស្ថានីយកដ្ឋាន',  colorScheme: '#7c3aed' }, 5),
  el('data-widget', ROW_X[3], 184, CARD_W, 78, { widgetType: 'issues_done',     title: 'ជ្រួតជ្រាក់',    colorScheme: '#059669' }, 6),

  // ─ Sessions section divider + heading
  el('divider', 30, 272, 734, 10, { color: '#e5e7eb', thickness: 1 }, 7),
  el('heading', 30, 286, 734, 28, {
    content: 'ប្រចាំថ្ងៃ — 2026-04-29', fontSize: 13, bold: true, color: '#111827',
  }, 8),
  // Session row 1: Sessions | kWh | Unique Users | Stations Used
  el('data-widget', ROW_X[0], 322, CARD_W, 78, { widgetType: 'issues_total',    title: 'ប្រចាំ',               colorScheme: '#2563eb' }, 9),
  el('data-widget', ROW_X[1], 322, CARD_W, 78, { widgetType: 'issues_done',     title: 'kWh ផ្ដល់',            colorScheme: '#f97316' }, 10),
  el('data-widget', ROW_X[2], 322, CARD_W, 78, { widgetType: 'users_total',     title: 'អ្នករស់ប្រើប្រាស់',   colorScheme: '#7c3aed' }, 11),
  el('data-widget', ROW_X[3], 322, CARD_W, 78, { widgetType: 'projects_total',  title: 'ស្ថានីយ',              colorScheme: '#0891b2' }, 12),
  // Session row 2: Success rate | Avg duration | Avg kWh | Active hours
  el('data-widget', ROW_X[0], 408, CARD_W, 78, { widgetType: 'issues_open',     title: 'ចំនួនជាក់ស្ដែង (%)',  colorScheme: '#059669' }, 13),
  el('data-widget', ROW_X[1], 408, CARD_W, 78, { widgetType: 'issues_overdue',  title: 'មធ្យមរយៈពេល',         colorScheme: '#0891b2' }, 14),
  el('data-widget', ROW_X[2], 408, CARD_W, 78, { widgetType: 'date_label',      title: 'kWh / ប្រចាំ',        colorScheme: '#f97316' }, 15),
  el('data-widget', ROW_X[3], 408, CARD_W, 78, { widgetType: 'date_label',      title: 'រយៈពេល',              colorScheme: '#6b7280' }, 16),

  // ─ Hourly chart
  el('divider', 30, 496, 734, 10, { color: '#e5e7eb', thickness: 1 }, 17),
  el('heading', 30, 510, 734, 24, {
    content: 'ប្រចាំ និងបានផ្ដល់ តាមមេ', fontSize: 13, bold: true, color: '#111827',
  }, 18),
  el('chart', 30, 540, 734, 200, {
    widgetType: 'issues_by_status', chartType: 'bar', title: '',
    colorScheme: '#60a5fa',
  }, 19),

  // ─ Station table
  el('divider', 30, 748, 734, 10, { color: '#e5e7eb', thickness: 1 }, 20),
  el('heading', 30, 762, 734, 24, {
    content: 'សក្ម្មភាពទីតាំ — ចៀនមួយថ្ងៃ', fontSize: 13, bold: true, color: '#111827',
  }, 21),
  el('table', 30, 792, 734, 290, {
    columns: ['ទីតាំ', 'ស្ថានីយ', 'ប្រចាំ', 'kWh', '% នៃសរុប'],
    rows: [
      { 'ទីតាំ': 'MEV Station',          'ស្ថានីយ': '2',  'ប្រចាំ': '68', 'kWh': '2,201.19', '% នៃសរុប': '58.1%' },
      { 'ទីតាំ': 'PITOU CAFETERIA Site', 'ស្ថានីយ': '3',  'ប្រចាំ': '7',  'kWh': '305.46',   '% នៃសរុប': '8.1%'  },
      { 'ទីតាំ': 'Kraya Park Rest Area', 'ស្ថានីយ': '2',  'ប្រចាំ': '7',  'kWh': '164.55',   '% នៃសរុប': '4.3%'  },
      { 'ទីតាំ': 'CGGEVxBAYON',          'ស្ថានីយ': '3',  'ប្រចាំ': '8',  'kWh': '152.15',   '% នៃសរុប': '4.0%'  },
      { 'ទីតាំ': 'Kafe Santiphap site',  'ស្ថានីយ': '19', 'ប្រចាំ': '14', 'kWh': '135.17',   '% នៃសរុប': '3.6%'  },
      { 'ទីតាំ': 'Evolt Energy Kaeng',   'ស្ថានីយ': '2',  'ប្រចាំ': '7',  'kWh': '124.05',   '% នៃសរុប': '3.3%'  },
      { 'ទីតាំ': 'The Sky EV',           'ស្ថានីយ': '1',  'ប្រចាំ': '5',  'kWh': '123.76',   '% នៃសរុប': '3.3%'  },
      { 'ទីតាំ': 'Telasaep',             'ស្ថានីយ': '1',  'ប្រចាំ': '4',  'kWh': '118.49',   '% នៃសរុប': '3.1%'  },
    ],
  }, 22),

  // ─ Page number
  el('page-number', 337, 1095, 120, 20, {}, 23),
];

// 3-column card layout: 3×234 + 2×16 gap = 734px usable (margin 30 each side)
const C3W = 234;
const C3G = 16;
const C3X = [30, 30 + C3W + C3G, 30 + (C3W + C3G) * 2]; // [30, 280, 530]

const UNIFYCHARGE_ELEMENTS: ReportElement[] = [
  // ─ Header: left orange accent bar
  el('shape', 0, 0, 6, 82, { shape: 'rect', fill: '#f97316', borderRadius: 0 }, 0),
  // ─ Header: brand name + tagline (left)
  el('heading', 16, 10, 210, 36, {
    content: 'UNIFYCHARGE',
    fontSize: 16, bold: true, color: '#f97316', background: 'transparent',
    textAlign: 'left', paddingX: 8, paddingY: 4,
  }, 1),
  el('text', 16, 46, 210, 24, {
    content: 'EV Charging Network',
    fontSize: 9, color: '#9ca3af', background: 'transparent', paddingX: 10,
  }, 2),
  // ─ Header: report title (right, Khmer)
  el('heading', 236, 6, 528, 42, {
    content: 'របាយការណ៍ប្រតិបត្តិការប្រចាំថ្ងៃ',
    fontSize: 18, bold: true, color: '#1d4ed8', background: 'transparent',
    textAlign: 'right', paddingX: 30, paddingY: 4,
  }, 3),
  el('text', 236, 50, 528, 22, {
    content: '2026-05-24  ·  តំបន់ Asia/Phnom_Penh  ·  Generated 2026-05-25 03:13',
    fontSize: 9, color: '#6b7280', background: 'transparent',
    textAlign: 'right', paddingX: 30, paddingY: 2,
  }, 4),
  // ─ Header bottom divider
  el('divider', 0, 80, 794, 6, { color: '#f3f4f6', thickness: 2 }, 5),

  // ─ Summary text (blue band)
  el('text', 30, 90, 734, 54, {
    content: 'សង្ខេប: ប្រតិបត្តិការសរុប 152, ចំណាត់ 4,146 kWh ទៅ ស្ថានីយ 28/42 ស្ថានីយ, ថូជាក 40/84 ថូជាក។\nស្ថានីយបញ្ចូលច្រើន: CGG (Kampong Saom) 756 kWh · Kraya Park Rest Area 573 kWh · CartEV 360 kWh',
    fontSize: 10, color: '#1e40af', background: '#dbeafe', paddingX: 14, paddingY: 10,
  }, 6),

  // ─ Top 3 stations section
  el('heading', 30, 152, 734, 26, {
    content: '● ស្ថានីយ ៣ ដែលបានបញ្ចូលចំណាត់ច្រើនជាងគេ',
    fontSize: 12, bold: true, color: '#1d4ed8', background: 'transparent',
  }, 7),
  el('table', 30, 184, 734, 128, {
    columns: ['#', 'ស្ថានីយ', 'ចូលជាក់', 'ប្រតិបត្តិការ', 'kWh', '% នៃចំណាត់', 'តម្លៃ'],
    rows: [
      { '#': '1', 'ស្ថានីយ': 'CGG (កំពង់សោម)', 'ចូលជាក់': '2', 'ប្រតិបត្តិការ': '30', 'kWh': '755.98', '% នៃចំណាត់': '18.2%', 'តម្លៃ': '1,232' },
      { '#': '2', 'ស្ថានីយ': 'Kraya Park Rest Area', 'ចូលជាក់': '2', 'ប្រតិបត្តិការ': '19', 'kWh': '572.60', '% នៃចំណាត់': '13.8%', 'តម្លៃ': '1,250' },
      { '#': '3', 'ស្ថានីយ': 'CartEV', 'ចូលជាក់': '1', 'ប្រតិបត្តិការ': '12', 'kWh': '359.66', '% នៃចំណាត់': '8.7%', 'តម្លៃ': '1,350' },
    ],
  }, 8),

  el('divider', 30, 318, 734, 8, { color: '#e5e7eb', thickness: 1 }, 9),

  // ─ OCPP stats section
  el('heading', 30, 330, 734, 26, {
    content: 'ស្ថិតិ OCPP', fontSize: 12, bold: true, color: '#111827', background: 'transparent',
  }, 10),
  // Row 1: Users | Sessions | Active Stations
  el('data-widget', C3X[0], 362, C3W, 86, { widgetType: 'users_total',    title: 'ចំនួនអ្នកស្ថានីយ',    colorScheme: '#2563eb' }, 11),
  el('data-widget', C3X[1], 362, C3W, 86, { widgetType: 'issues_total',   title: 'ចំនួនប្រតិបត្តិការ', colorScheme: '#6366f1' }, 12),
  el('data-widget', C3X[2], 362, C3W, 86, { widgetType: 'projects_total', title: 'ស្ថានីយដែលសកម្ម',    colorScheme: '#0891b2' }, 13),
  // Row 2: kWh | Revenue | Avg duration
  el('data-widget', C3X[0], 456, C3W, 86, { widgetType: 'issues_done',    title: 'ចំណាត់ (kWh)',       colorScheme: '#f97316' }, 14),
  el('data-widget', C3X[1], 456, C3W, 86, { widgetType: 'date_label',     title: 'វីតករក់ (M រៀល)',    colorScheme: '#059669' }, 15),
  el('data-widget', C3X[2], 456, C3W, 86, { widgetType: 'issues_overdue', title: 'រយៈពេល (min)',       colorScheme: '#7c3aed' }, 16),

  el('divider', 30, 548, 734, 8, { color: '#e5e7eb', thickness: 1 }, 17),

  // ─ Session detail stats
  el('heading', 30, 560, 734, 26, {
    content: 'ប្រតិបត្តិការ — 2026-05-24', fontSize: 12, bold: true, color: '#111827', background: 'transparent',
  }, 18),
  // Row 1
  el('data-widget', C3X[0], 592, C3W, 86, { widgetType: 'issues_total',  title: 'ចំណាត់/ប្រតិបត្តិការ (kWh)', colorScheme: '#2563eb' }, 19),
  el('data-widget', C3X[1], 592, C3W, 86, { widgetType: 'date_label',    title: 'ម៉ោងខ្ពស់ (Peak Hour)',       colorScheme: '#f59e0b' }, 20),
  el('data-widget', C3X[2], 592, C3W, 86, { widgetType: 'issues_done',   title: 'GB/T Connectors',              colorScheme: '#059669' }, 21),
  // Row 2
  el('data-widget', C3X[0], 686, C3W, 86, { widgetType: 'issues_open',   title: 'CCS2 Connectors',              colorScheme: '#6b7280' }, 22),
  el('data-widget', C3X[1], 686, C3W, 86, { widgetType: 'issues_done',   title: 'ចំណូលសរុប (រៀល)',             colorScheme: '#16a34a' }, 23),
  el('data-widget', C3X[2], 686, C3W, 86, { widgetType: 'projects_total', title: 'ស្ថានីយក្រៅបណ្ដាញ',          colorScheme: '#ef4444' }, 24),

  el('divider', 30, 778, 734, 8, { color: '#e5e7eb', thickness: 1 }, 25),

  // ─ Hourly chart
  el('heading', 30, 790, 734, 26, {
    content: 'ចំនួនប្រតិបត្តិការ និងចំណាត់ (kWh) តាមមេ', fontSize: 12, bold: true, color: '#111827', background: 'transparent',
  }, 26),
  el('chart', 30, 820, 734, 200, {
    widgetType: 'issues_by_status', chartType: 'bar', title: '', colorScheme: '#3b82f6',
  }, 27),

  el('divider', 30, 1026, 734, 8, { color: '#e5e7eb', thickness: 1 }, 28),

  // ─ Province breakdown table
  el('heading', 30, 1038, 734, 26, {
    content: 'ស្ថិតិទូតំបន់ស្ថានីយ', fontSize: 12, bold: true, color: '#111827', background: 'transparent',
  }, 29),
  el('table', 30, 1070, 734, 266, {
    columns: ['ខេត្ត', 'ស្ថានីយ', 'ប្រតិបត្តិការ', 'kWh'],
    rows: [
      { 'ខេត្ត': 'ភ្នំពេញ',    'ស្ថានីយ': '5', 'ប្រតិបត្តិការ': '38', 'kWh': '983' },
      { 'ខេត្ត': 'ក្រចេះ',     'ស្ថានីយ': '5', 'ប្រតិបត្តិការ': '25', 'kWh': '744' },
      { 'ខេត្ត': 'ចោហ្ជាង',   'ស្ថានីយ': '7', 'ប្រតិបត្តិការ': '23', 'kWh': '673' },
      { 'ខេត្ត': 'កណ្ដាល',    'ស្ថានីយ': '1', 'ប្រតិបត្តិការ': '19', 'kWh': '573' },
      { 'ខេត្ត': 'សៀមរាប',    'ស្ថានីយ': '3', 'ប្រតិបត្តិការ': '21', 'kWh': '488' },
      { 'ខេត្ត': 'កំពង់ចាម',  'ស្ថានីយ': '2', 'ប្រតិបត្តិការ': '11', 'kWh': '281' },
      { 'ខេត្ត': 'កំពង់ធំ',   'ស្ថានីយ': '1', 'ប្រតិបត្តិការ': '9',  'kWh': '216' },
    ],
  }, 30),

  el('divider', 30, 1342, 734, 8, { color: '#e5e7eb', thickness: 1 }, 31),

  // ─ Operator table
  el('heading', 30, 1354, 734, 26, {
    content: 'ស្ថិតិតាមក្រុមហ៊ុន', fontSize: 12, bold: true, color: '#111827', background: 'transparent',
  }, 32),
  el('table', 30, 1386, 734, 200, {
    columns: ['ក្រុមហ៊ុន', 'ស្ថានីយ', 'ចូលជាក់', 'ប្រតិបត្តិការ', 'kWh', 'តម្លៃ/kWh', 'ចំណូល (រៀល)'],
    rows: [
      { 'ក្រុមហ៊ុន': 'CGGEV Energy', 'ស្ថានីយ': 'CGG (កំពង់សោម)',   'ចូលជាក់': 'OCHHERTEA L', 'ប្រតិបត្តិការ': '13', 'kWh': '445.62', 'តម្លៃ/kWh': '1,150', 'ចំណូល (រៀល)': '512,461' },
      { 'ក្រុមហ៊ុន': '',             'ស្ថានីយ': 'CGG Total Angkor', 'ចូលជាក់': 'BOREIANKO R', 'ប្រតិបត្តិការ': '5',  'kWh': '152.74', 'តម្លៃ/kWh': '1,150', 'ចំណូល (រៀល)': '175,650' },
      { 'ក្រុមហ៊ុន': 'Kraya Park',  'ស្ថានីយ': 'Kraya Park Rest',  'ចូលជាក់': 'EP-KYP03',   'ប្រតិបត្តិការ': '13', 'kWh': '348.21', 'តម្លៃ/kWh': '1,250', 'ចំណូល (រៀល)': '435,260' },
      { 'ក្រុមហ៊ុន': 'CartEV',      'ស្ថានីយ': 'CartEV',           'ចូលជាក់': 'cartev-sr-03','ប្រតិបត្តិការ': '12', 'kWh': '359.66', 'តម្លៃ/kWh': '1,350', 'ចំណូល (រៀល)': '485,541' },
      { 'ក្រុមហ៊ុន': 'PITOU Cafe',  'ស្ថានីយ': 'PITOU Cafeteria', 'ចូលជាក់': 'MT0001',      'ប្រតិបត្តិការ': '11', 'kWh': '336.51', 'តម្លៃ/kWh': '1,000', 'ចំណូល (រៀល)': '336,510' },
    ],
  }, 33),

  el('divider', 30, 1592, 734, 8, { color: '#e5e7eb', thickness: 1 }, 34),

  // ─ Station ranking table
  el('heading', 30, 1604, 734, 26, {
    content: 'ស្ថិតិតាមស្ថានីយ', fontSize: 12, bold: true, color: '#111827', background: 'transparent',
  }, 35),
  el('table', 30, 1636, 734, 200, {
    columns: ['ស្ថានីយ', 'ក្រុមហ៊ុន', 'ខេត្ត', 'ប្រតិបត្តិការ', 'kWh', 'តម្លៃ/kWh', 'ចំណូល (រៀល)'],
    rows: [
      { 'ស្ថានីយ': 'CGG (កំពង់សោម)',     'ក្រុមហ៊ុន': 'CGGEV Energy',    'ខេត្ត': 'ភ្នំពេញ',   'ប្រតិបត្តិការ': '30', 'kWh': '755.98', 'តម្លៃ/kWh': '1,232', 'ចំណូល (រៀល)': '931,447' },
      { 'ស្ថានីយ': 'Kraya Park Rest Area', 'ក្រុមហ៊ុន': 'Kraya Park',      'ខេត្ត': 'កណ្ដាល',    'ប្រតិបត្តិការ': '19', 'kWh': '572.60', 'តម្លៃ/kWh': '1,250', 'ចំណូល (រៀល)': '715,751' },
      { 'ស្ថានីយ': 'CartEV',              'ក្រុមហ៊ុន': 'CartEV',          'ខេត្ត': 'សៀមរាប',    'ប្រតិបត្តិការ': '12', 'kWh': '359.66', 'តម្លៃ/kWh': '1,350', 'ចំណូល (រៀល)': '485,541' },
      { 'ស្ថានីយ': 'PITOU Cafeteria Site', 'ក្រុមហ៊ុន': 'PITOU Cafeteria', 'ខេត្ត': 'ក្រចេះ',    'ប្រតិបត្តិការ': '11', 'kWh': '336.51', 'តម្លៃ/kWh': '1,000', 'ចំណូល (រៀល)': '336,510' },
      { 'ស្ថានីយ': 'Evolt Energy (ក្រោង)', 'ក្រុមហ៊ុន': 'Evolt Energy',    'ខេត្ត': 'កំពង់ចាម',  'ប្រតិបត្តិការ': '9',  'kWh': '216.49', 'តម្លៃ/kWh': '1,350', 'ចំណូល (រៀល)': '292,262' },
    ],
  }, 36),

  // ─ Page number (footer)
  el('page-number', 337, 1848, 120, 20, {}, 37),
];

const DASHBOARD_ELEMENTS: ReportElement[] = [
  el('heading', 0, 0, 794, 70, {
    content: 'Monthly Dashboard Report',
    fontSize: 22, bold: true, color: '#ffffff', background: '#6366f1',
    textAlign: 'center', paddingY: 20,
  }, 0),
  el('data-widget', ROW_X[0], 84, CARD_W, 88, { widgetType: 'issues_total',   title: 'Total Issues',    colorScheme: '#6366f1' }, 1),
  el('data-widget', ROW_X[1], 84, CARD_W, 88, { widgetType: 'issues_open',    title: 'Open',           colorScheme: '#f59e0b' }, 2),
  el('data-widget', ROW_X[2], 84, CARD_W, 88, { widgetType: 'issues_done',    title: 'Completed',      colorScheme: '#22c55e' }, 3),
  el('data-widget', ROW_X[3], 84, CARD_W, 88, { widgetType: 'issues_overdue', title: 'Overdue',        colorScheme: '#ef4444' }, 4),
  el('chart', 30, 188, 350, 220, { widgetType: 'issues_by_status',   chartType: 'bar',  title: 'Issues by Status',     colorScheme: '#6366f1' }, 5),
  el('chart', 394, 188, 370, 220, { widgetType: 'users_by_department', chartType: 'pie', title: 'Team by Department',   colorScheme: '#6366f1' }, 6),
  el('divider', 30, 424, 734, 10, { color: '#e5e7eb' }, 7),
  el('data-widget', 30, 440, 354, 160,  { widgetType: 'projects_list', title: 'Project Progress', colorScheme: '#6366f1' }, 8),
  el('data-widget', 410, 440, 354, 160, { widgetType: 'issues_table', title: 'Recent Issues',    colorScheme: '#6366f1' }, 9),
  el('page-number', 337, 1095, 120, 20, {}, 10),
];

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start with an empty canvas',
    icon: <FileText className="w-5 h-5" />,
    pageSize: 'A4',
    orientation: 'portrait',
    background: '#ffffff',
    elements: [],
    preview: (
      <div className="w-full h-full bg-white border border-gray-200 rounded flex items-center justify-center">
        <span className="text-xs text-gray-300">Empty canvas</span>
      </div>
    ),
  },
  {
    id: 'ev-charging',
    label: 'EV Charging Daily Report',
    description: 'KPI cards · OCPP stats · Hourly chart · Station table',
    icon: <Zap className="w-5 h-5" />,
    pageSize: 'A4',
    orientation: 'portrait',
    background: '#ffffff',
    elements: EV_CHARGING_ELEMENTS,
    preview: (
      <div className="w-full h-full rounded overflow-hidden flex flex-col text-[6px]">
        {/* Header */}
        <div className="bg-blue-600 text-white px-2 py-1.5 font-bold flex-shrink-0">
          EV Charging Daily Report
        </div>
        {/* Summary */}
        <div className="bg-blue-50 text-blue-700 px-2 py-0.5 flex-shrink-0 truncate">
          ទិដ្ឋភាពសង្ខេប: ប្រចាំ 148...
        </div>
        {/* KPI row 1 */}
        <div className="flex gap-0.5 px-1 pt-1 flex-shrink-0">
          {['25', '30', '92', '140'].map((v) => (
            <div key={v} className="flex-1 bg-blue-50 border border-blue-100 rounded text-center py-0.5">
              <div className="text-[7px] font-bold text-blue-700">{v}</div>
            </div>
          ))}
        </div>
        {/* KPI row 2 */}
        <div className="flex gap-0.5 px-1 pt-0.5 flex-shrink-0">
          {['148', '3,789', '104', '27'].map((v) => (
            <div key={v} className="flex-1 bg-gray-50 border border-gray-100 rounded text-center py-0.5">
              <div className="text-[7px] font-bold text-gray-700">{v}</div>
            </div>
          ))}
        </div>
        {/* Chart placeholder */}
        <div className="flex-1 mx-1 mt-0.5 bg-gray-50 border border-gray-100 rounded flex items-end gap-px px-1 pb-1">
          {[2,3,5,6,8,7,11,12,15,11,8,6,5].map((h, i) => (
            <div key={i} className="flex-1 bg-blue-400 rounded-sm" style={{ height: `${h * 4}%` }} />
          ))}
        </div>
        {/* Table placeholder */}
        <div className="mx-1 mt-0.5 mb-1 flex-shrink-0">
          {['MEV Station', 'PITOU Site', 'Kraya Park'].map((n) => (
            <div key={n} className="flex gap-1 border-b border-gray-100 py-px">
              <span className="flex-1 truncate text-gray-600">{n}</span>
              <span className="text-gray-400">kWh</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'unifycharge-daily',
    label: 'UnifyCharge Daily Report',
    description: 'Top-3 table · OCPP/Session stats · Hourly chart · Province & station tables',
    icon: <Activity className="w-5 h-5" />,
    pageSize: 'A4',
    orientation: 'portrait',
    background: '#ffffff',
    elements: UNIFYCHARGE_ELEMENTS,
    preview: (
      <div className="w-full h-full rounded overflow-hidden flex flex-col text-[6px]">
        {/* Header */}
        <div className="flex items-center flex-shrink-0 border-b border-gray-100 bg-white" style={{ minHeight: 22, borderLeft: '3px solid #f97316' }}>
          <span className="font-bold text-orange-500 px-1.5" style={{ fontSize: 6 }}>UNIFYCHARGE</span>
          <span className="ml-auto text-blue-700 font-bold pr-1.5 truncate" style={{ fontSize: 5.5 }}>របាយការណ៍ប្រចាំថ្ងៃ</span>
        </div>
        {/* Summary blue band */}
        <div className="bg-blue-50 text-blue-700 px-1.5 py-0.5 flex-shrink-0 leading-tight" style={{ fontSize: 5 }}>
          សង្ខេប: ប្រ 152 · 4,146 kWh · CGG 756 · Kraya 573 · CartEV 360
        </div>
        {/* Top 3 table mini */}
        <div className="px-1 pt-0.5 flex-shrink-0">
          <div className="text-blue-700 font-bold mb-0.5" style={{ fontSize: 5.5 }}>● ស្ថានីយ ៣ ដែលបញ្ចូលច្រើន</div>
          {[['CGG (កំពង់)', '756', '18.2%'], ['Kraya Park', '573', '13.8%'], ['CartEV', '360', '8.7%']].map(([n, k, p]) => (
            <div key={n} className="flex gap-1 border-b border-gray-100 py-px">
              <span className="flex-1 truncate text-gray-600">{n}</span>
              <span className="text-gray-500">{k}</span>
              <span className="text-blue-600">{p}</span>
            </div>
          ))}
        </div>
        {/* Stat cards 2×3 */}
        <div className="flex gap-0.5 px-1 pt-1 flex-shrink-0">
          {[['110','អ្នក','#2563eb'], ['152','ប្រ','#6366f1'], ['28','ស្ថ','#0891b2']].map(([v,l,c]) => (
            <div key={l} className="flex-1 rounded text-center py-0.5 border" style={{ borderColor: c + '33', background: c + '11' }}>
              <div className="font-bold" style={{ color: c, fontSize: 7 }}>{v}</div>
              <div className="text-gray-400" style={{ fontSize: 4.5 }}>{l}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-0.5 px-1 pt-0.5 flex-shrink-0">
          {[['4,146','kWh','#f97316'], ['4.93M','រៀល','#059669'], ['69.7','min','#7c3aed']].map(([v,l,c]) => (
            <div key={l} className="flex-1 rounded text-center py-0.5 border" style={{ borderColor: c + '33', background: c + '11' }}>
              <div className="font-bold" style={{ color: c, fontSize: 6.5 }}>{v}</div>
              <div className="text-gray-400" style={{ fontSize: 4.5 }}>{l}</div>
            </div>
          ))}
        </div>
        {/* Hourly bar chart */}
        <div className="flex-1 mx-1 mt-0.5 bg-gray-50 border border-gray-100 rounded flex items-end gap-px px-0.5 pb-0.5">
          {[1,2,2,3,5,7,9,12,15,14,11,8,6,10,13,11,8,6,4,3,2,2,1,1].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${h * 5}%`, background: '#3b82f6' }} />
          ))}
        </div>
        {/* Province table mini */}
        <div className="mx-1 mt-0.5 mb-0.5 flex-shrink-0">
          {[['ភ្នំពេញ','38','983'], ['ក្រចេះ','25','744'], ['ចោហ្ជាង','23','673']].map(([p, s, k]) => (
            <div key={p} className="flex gap-1 border-b border-gray-100 py-px">
              <span className="flex-1 truncate text-gray-600">{p}</span>
              <span className="text-gray-400">{s}</span>
              <span className="text-blue-600">{k}</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'dashboard',
    label: 'Monthly Dashboard',
    description: 'KPI cards · Bar & pie charts · Progress list · Issues table',
    icon: <BarChart2 className="w-5 h-5" />,
    pageSize: 'A4',
    orientation: 'portrait',
    background: '#ffffff',
    elements: DASHBOARD_ELEMENTS,
    preview: (
      <div className="w-full h-full rounded overflow-hidden flex flex-col text-[6px]">
        <div className="bg-indigo-600 text-white px-2 py-1.5 font-bold flex-shrink-0">
          Monthly Dashboard Report
        </div>
        <div className="flex gap-0.5 px-1 pt-1 flex-shrink-0">
          {['142', '67', '75', '8'].map((v, i) => (
            <div key={i} className="flex-1 border border-gray-100 rounded text-center py-0.5 bg-gray-50">
              <div className="text-[7px] font-bold text-gray-700">{v}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-0.5 flex-1 mx-1 mt-0.5 min-h-0">
          <div className="flex-1 bg-gray-50 border border-gray-100 rounded flex items-end gap-px px-1 pb-1">
            {[67,31,75,8].map((h, i) => (
              <div key={i} className="flex-1 bg-indigo-400 rounded-sm" style={{ height: `${h}%` }} />
            ))}
          </div>
          <div className="flex-1 bg-gray-50 border border-gray-100 rounded flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-4 border-indigo-300" />
          </div>
        </div>
        <div className="mx-1 mt-0.5 mb-1 space-y-px flex-shrink-0">
          {['Prism Platform 72%', 'Mobile App 45%', 'API Overhaul 90%'].map((n) => (
            <div key={n} className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 rounded-full" style={{ width: n.includes('72') ? '72%' : n.includes('45') ? '45%' : '90%' }} />
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

// ── Modal ─────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (template: ReportTemplate) => Promise<void>;
  /** User-saved reports marked as templates */
  savedTemplates?: SavedTemplate[];
  onCreateFromSaved?: (saved: SavedTemplate) => Promise<void>;
}

export function NewReportModal({ open, onClose, onCreate, savedTemplates = [], onCreateFromSaved }: Props) {
  const [selected, setSelected]         = useState<string>('blank');
  const [selectedSaved, setSelectedSaved] = useState<string | null>(null);
  const [loading, setLoading]           = useState(false);

  if (!open) return null;

  const isBuiltIn = !selectedSaved;
  const picked    = REPORT_TEMPLATES.find((t) => t.id === selected)!;

  const handleCreate = async () => {
    setLoading(true);
    try {
      if (selectedSaved && onCreateFromSaved) {
        const tmpl = savedTemplates.find((t) => t._id === selectedSaved)!;
        await onCreateFromSaved(tmpl);
      } else {
        await onCreate(picked);
      }
    } finally {
      setLoading(false);
    }
  };

  const selectBuiltin = (id: string) => { setSelected(id); setSelectedSaved(null); };
  const selectSaved   = (id: string) => { setSelectedSaved(id); };

  const footerInfo = selectedSaved
    ? (() => {
        const t = savedTemplates.find((s) => s._id === selectedSaved);
        return t
          ? `${t.elements.length} elements · ${t.pageSize} ${t.orientation}`
          : '';
      })()
    : picked.elements.length > 0
      ? `${picked.elements.length} pre-built elements · ${picked.pageSize} ${picked.orientation}`
      : `Empty canvas · ${picked.pageSize} ${picked.orientation}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-modal-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold">New Report</h2>
            <p className="text-xs text-text-muted mt-0.5">Choose a template to start from</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-hover text-text-muted hover:text-text transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[60vh] p-6 space-y-6">
          {/* User-saved templates section */}
          {savedTemplates.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <BookTemplate className="w-3.5 h-3.5 text-accent-600" />
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  My Templates
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {savedTemplates.map((tmpl) => (
                  <button
                    key={tmpl._id}
                    onClick={() => selectSaved(tmpl._id)}
                    className={[
                      'flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all',
                      selectedSaved === tmpl._id
                        ? 'border-accent-600 shadow-md ring-2 ring-accent-600/20'
                        : 'border-border hover:border-accent-300 hover:shadow-sm',
                    ].join(' ')}
                  >
                    <div
                      className="h-28 flex items-center justify-center relative overflow-hidden"
                      style={{ background: tmpl.background ?? '#f8fafc' }}
                    >
                      {tmpl.thumbnail
                        ? <img src={tmpl.thumbnail} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        : (
                          <div className="flex flex-col gap-1.5 px-4 py-3 w-full" style={{ color: '#94a3b8' }}>
                            <div className="h-2 w-2/5 rounded-full bg-current opacity-40" />
                            <div className="h-1.5 w-3/5 rounded-full bg-current opacity-25" />
                            <div className="flex gap-1 h-8 mt-1 opacity-30">
                              {[50, 75, 40, 88, 60].map((h, i) => (
                                <div key={i} className="flex-1 rounded-t bg-current" style={{ height: `${h}%` }} />
                              ))}
                            </div>
                          </div>
                        )}
                      <div className="absolute top-1.5 left-1.5">
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-accent-600 text-white">
                          My template
                        </span>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 border-t border-border bg-bg-card">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <BookTemplate className="w-3.5 h-3.5 text-accent-600" />
                        <span className="text-xs font-semibold text-text truncate">{tmpl.name}</span>
                      </div>
                      <p className="text-[11px] text-text-muted leading-snug line-clamp-1">
                        {tmpl.description || `${tmpl.elements.length} elements`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Built-in templates */}
          <div>
            {savedTemplates.length > 0 && (
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
                Built-in Templates
              </p>
            )}
            <div className="grid grid-cols-3 gap-4">
              {REPORT_TEMPLATES.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => selectBuiltin(tmpl.id)}
                  className={[
                    'flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all',
                    isBuiltIn && selected === tmpl.id
                      ? 'border-accent-600 shadow-md ring-2 ring-accent-600/20'
                      : 'border-border hover:border-accent-300 hover:shadow-sm',
                  ].join(' ')}
                >
                  <div className="h-36 bg-bg-subtle p-2">
                    {tmpl.preview}
                  </div>
                  <div className="px-3 py-2.5 border-t border-border bg-bg-card">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-accent-600">{tmpl.icon}</span>
                      <span className="text-xs font-semibold text-text">{tmpl.label}</span>
                    </div>
                    <p className="text-[11px] text-text-muted leading-snug">{tmpl.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-subtle">
          <div className="text-xs text-text-muted">{footerInfo}</div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleCreate} disabled={loading} className="gap-1.5 min-w-[110px]">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {loading ? 'Creating…' : 'Create Report'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
