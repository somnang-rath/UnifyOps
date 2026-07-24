'use client';
import { useState, useMemo } from 'react';
import { FUNCTION_REGISTRY, FN_CATEGORIES, type FnCategory, type FnDef } from '@/lib/sheets/function-registry';

export interface FunctionWizardProps {
  currentFormula: string;
  onInsert: (formula: string) => void;
}

interface Props extends FunctionWizardProps {
  onClose: () => void;
}

const CATEGORY_ICONS: Record<FnCategory, string> = {
  'Math': 'Σ',
  'Logical': '?',
  'Text': 'T',
  'Date & Time': '📅',
  'Lookup': '🔍',
  'Conditional': '≡',
  'Statistical': '≈',
  'Financial': '$',
  'Info': 'i',
};

export function FunctionWizard({ currentFormula, onInsert, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<FnCategory | 'All'>('All');
  const [selectedFn, setSelectedFn] = useState<FnDef | null>(null);
  const [argValues, setArgValues] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return FUNCTION_REGISTRY.filter((fn) => {
      const catMatch = selectedCat === 'All' || fn.category === selectedCat;
      if (!q) return catMatch;
      return catMatch && (fn.name.includes(q) || fn.desc.toUpperCase().includes(q));
    });
  }, [search, selectedCat]);

  function selectFn(fn: FnDef) {
    setSelectedFn(fn);
    setArgValues(fn.args.map(() => ''));
  }

  function buildFormula(): string {
    if (!selectedFn) return currentFormula;
    const filled = argValues
      .map((v, i) => v.trim() || (selectedFn.args[i]?.optional ? '' : selectedFn.args[i]?.name ?? ''))
      .filter((v, i) => v || !selectedFn.args[i]?.optional)
      .join(', ');
    return `=${selectedFn.name}(${filled})`;
  }

  function handleInsert() {
    onInsert(buildFormula());
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-bg-card rounded-lg shadow-xl w-[720px] max-h-[560px] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text">Insert Function</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text text-lg leading-none">✕</button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search functions…"
            className="w-full h-8 px-3 rounded border border-border text-[13px] outline-none focus:border-accent-400 bg-bg-input"
          />
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Category list */}
          <div className="w-[160px] flex-none border-r border-border overflow-y-auto py-1">
            <button
              onClick={() => setSelectedCat('All')}
              className={`w-full text-left px-3 py-1.5 text-[12px] ${selectedCat === 'All' ? 'bg-accent-50 text-accent-700 font-medium' : 'text-text hover:bg-bg-subtle'}`}
            >
              All Functions
            </button>
            {FN_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCat(cat)}
                className={`w-full text-left px-3 py-1.5 text-[12px] flex items-center gap-2 ${selectedCat === cat ? 'bg-accent-50 text-accent-700 font-medium' : 'text-text hover:bg-bg-subtle'}`}
              >
                <span className="text-[11px] opacity-60">{CATEGORY_ICONS[cat]}</span>
                {cat}
              </button>
            ))}
          </div>

          {/* Function list */}
          <div className="w-[220px] flex-none border-r border-border overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-[12px] text-text-muted text-center">No functions found</p>
            )}
            {filtered.map((fn) => (
              <button
                key={fn.name}
                onClick={() => selectFn(fn)}
                className={`w-full text-left px-3 py-1.5 text-[12px] font-mono ${selectedFn?.name === fn.name ? 'bg-accent-50 text-accent-700 font-semibold' : 'text-text hover:bg-bg-subtle'}`}
              >
                {fn.name}
                <span className="ml-1.5 font-sans text-[10px] text-text-muted font-normal">{fn.category}</span>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedFn ? (
              <div className="flex-1 flex items-center justify-center text-text-muted text-[13px]">
                Select a function to see its details
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-y-auto px-4 py-3 gap-3">
                <div>
                  <p className="font-mono text-[13px] font-semibold text-accent-700">{selectedFn.syntax}</p>
                  <p className="text-[12px] text-text-sub mt-1">{selectedFn.desc}</p>
                  <p className="text-[11px] text-text-muted mt-1 font-mono">Example: {selectedFn.example}</p>
                </div>

                {selectedFn.args.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Arguments</p>
                    {selectedFn.args.map((arg, i) => (
                      <div key={arg.name}>
                        <label className="text-[11px] font-medium text-text-sub">
                          {arg.name}
                          {arg.optional && <span className="ml-1 text-text-muted font-normal">(optional)</span>}
                        </label>
                        <p className="text-[10px] text-text-muted mb-1">{arg.desc}</p>
                        <input
                          value={argValues[i] ?? ''}
                          onChange={(e) => {
                            const next = [...argValues];
                            next[i] = e.target.value;
                            setArgValues(next);
                          }}
                          placeholder={arg.name}
                          className="w-full h-7 px-2 rounded border border-border text-[12px] font-mono outline-none focus:border-accent-400 bg-bg-input"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-auto pt-2 border-t border-border">
                  <p className="text-[10px] text-text-muted mb-1">Preview formula</p>
                  <p className="font-mono text-[12px] text-text bg-bg-subtle px-2 py-1 rounded border border-border break-all">
                    {buildFormula()}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-bg-subtle">
          <button onClick={onClose} className="px-3 py-1.5 text-[13px] text-text hover:bg-bg-hover rounded border border-border">
            Cancel
          </button>
          <button
            onClick={handleInsert}
            disabled={!selectedFn}
            className="px-4 py-1.5 text-[13px] bg-accent-600 text-white rounded hover:bg-accent-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
