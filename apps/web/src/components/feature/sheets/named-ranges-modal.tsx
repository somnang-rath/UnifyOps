'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Field } from '@/components/ui/input';
import type { NamedRange } from '@/schemas/workbook';

interface Props {
  open: boolean;
  namedRanges: NamedRange[];
  sheets: Array<{ id: string; name: string }>;
  activeSheetId: string;
  onClose: () => void;
  onAdd: (nr: NamedRange) => void;
  onRemove: (name: string) => void;
}

function colLetter(n: number): string {
  let s = '';
  n++;
  while (n > 0) {
    s = String.fromCharCode(64 + ((n - 1) % 26 + 1)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function colIndex(col: string): number {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n - 1;
}

function parseRangeStr(str: string): NamedRange['range'] | null {
  const s = str.trim().toUpperCase();
  const single = /^([A-Z]+)(\d+)$/.exec(s);
  if (single) {
    const c = colIndex(single[1]);
    const r = parseInt(single[2], 10) - 1;
    if (c < 0 || r < 0) return null;
    return { r1: r, c1: c, r2: r, c2: c };
  }
  const range = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(s);
  if (range) {
    const c1 = colIndex(range[1]);
    const r1 = parseInt(range[2], 10) - 1;
    const c2 = colIndex(range[3]);
    const r2 = parseInt(range[4], 10) - 1;
    if (c1 < 0 || r1 < 0 || c2 < 0 || r2 < 0) return null;
    return {
      r1: Math.min(r1, r2),
      c1: Math.min(c1, c2),
      r2: Math.max(r1, r2),
      c2: Math.max(c1, c2),
    };
  }
  return null;
}

function rangeToStr(r: NamedRange['range']): string {
  if (r.r1 === r.r2 && r.c1 === r.c2) return `${colLetter(r.c1)}${r.r1 + 1}`;
  return `${colLetter(r.c1)}${r.r1 + 1}:${colLetter(r.c2)}${r.r2 + 1}`;
}

export function NamedRangesModal({
  open,
  namedRanges,
  sheets,
  activeSheetId,
  onClose,
  onAdd,
  onRemove,
}: Props) {
  const [name, setName] = useState('');
  const [rangeStr, setRangeStr] = useState('');
  const [sheetId, setSheetId] = useState(activeSheetId);
  const [err, setErr] = useState('');

  const submit = () => {
    const trimName = name.trim().toUpperCase();
    if (!trimName) { setErr('Name is required'); return; }
    if (!/^[A-Z_][A-Z0-9_]*$/.test(trimName)) {
      setErr('Name must start with a letter and contain only letters, numbers, or _');
      return;
    }
    const range = parseRangeStr(rangeStr);
    if (!range) { setErr('Invalid range — use A1 or A1:C5 format'); return; }
    if (namedRanges.some((r) => r.name === trimName && r.sheetId === sheetId)) {
      setErr('A range with that name already exists on this sheet');
      return;
    }
    onAdd({ name: trimName, sheetId, range });
    setName('');
    setRangeStr('');
    setErr('');
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title="Named ranges">
      <div className="space-y-5">
        {namedRanges.length > 0 && (
          <div className="border border-border rounded divide-y divide-border max-h-48 overflow-y-auto text-[13px]">
            {namedRanges.map((nr) => (
              <div
                key={`${nr.sheetId}/${nr.name}`}
                className="flex items-center justify-between px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="font-mono font-medium">{nr.name}</span>
                  <span className="text-text-muted ml-2">
                    {sheets.find((s) => s.id === nr.sheetId)?.name ?? '?'} ·{' '}
                    {rangeToStr(nr.range)}
                  </span>
                </div>
                <button
                  onClick={() => onRemove(nr.name)}
                  className="ml-3 text-text-muted hover:text-red-500 flex-shrink-0 px-1"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3">
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">
            Add new range
          </p>
          <div className="flex gap-2">
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setErr(''); }}
                placeholder="e.g. SalesData"
              />
            </Field>
            <Field label="Range">
              <Input
                value={rangeStr}
                onChange={(e) => { setRangeStr(e.target.value); setErr(''); }}
                placeholder="e.g. A1:C10"
                className="w-36"
              />
            </Field>
          </div>
          {sheets.length > 1 && (
            <Field label="Sheet">
              <select
                value={sheetId}
                onChange={(e) => setSheetId(e.target.value)}
                className="w-full border border-border rounded-sm px-3 py-[9px] text-[13px] bg-bg-input outline-none focus:border-accent"
              >
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          )}
          {err && (
            <p className="text-[12px] text-red-500">{err}</p>
          )}
          <Button variant="primary" onClick={submit}>Add range</Button>
        </div>
      </div>
    </Modal>
  );
}
