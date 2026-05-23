'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { FunctionWizardProps } from './function-wizard';

type Dir = 'up' | 'down' | 'left' | 'right' | null;

export interface FormulaBarHandle {
  /** Insert text at the last-known cursor position and re-focus the input. */
  injectAtCursor: (text: string) => void;
  /** Replace a slice of the formula text without moving focus. */
  replaceRange: (start: number, len: number, text: string) => void;
  /** Return the saved cursor position (captured on last blur). */
  getCursorPos: () => number;
}

interface Props {
  cellRef: string;
  value: string;
  editing: boolean;
  onFocus: () => void;
  onChange: (v: string, programmatic?: boolean) => void;
  onCommit: (dir: Dir) => void;
  onCancel: () => void;
  onNavigate: (ref: string) => void;
  onOpenWizard?: (props: FunctionWizardProps) => void;
}

export const FormulaBar = forwardRef<FormulaBarHandle, Props>(function FormulaBar({
  cellRef,
  value,
  editing,
  onFocus,
  onChange,
  onCommit,
  onCancel,
  onNavigate,
  onOpenWizard,
}, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // Preserves cursor position across blur so header-click injections land correctly.
  // -1 = never focused (fall back to end-of-value).
  const savedCursorRef = useRef<number>(-1);

  useImperativeHandle(ref, () => ({
    injectAtCursor(text: string) {
      const el = inputRef.current;
      if (!el) return;
      const saved = savedCursorRef.current;
      const pos = document.activeElement === el
        ? (el.selectionStart ?? el.value.length)
        : saved >= 0 ? saved : el.value.length;
      const newVal = el.value.slice(0, pos) + text + el.value.slice(pos);
      el.value = newVal;
      el.focus();
      el.setSelectionRange(pos + text.length, pos + text.length);
      onChange(newVal, true);
    },
    replaceRange(start: number, len: number, text: string) {
      const el = inputRef.current;
      if (!el) return;
      const newVal = el.value.slice(0, start) + text + el.value.slice(start + len);
      el.value = newVal;
      onChange(newVal, true);
    },
    getCursorPos() {
      const el = inputRef.current;
      const saved = savedCursorRef.current;
      if (!el) return saved >= 0 ? saved : 0;
      return document.activeElement === el
        ? (el.selectionStart ?? el.value.length)
        : saved >= 0 ? saved : el.value.length;
    },
  }), [onChange]);

  // Keep formula input in sync with prop when not focused.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    if (el.value !== value) el.value = value;
  }, [value]);

  function handleNameFocus() {
    setNameDraft(cellRef);
    requestAnimationFrame(() => nameRef.current?.select());
  }

  function handleNameBlur() {
    setNameDraft(null);
  }

  function handleNameKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = (e.currentTarget.value ?? '').trim().toUpperCase();
      if (v) onNavigate(v);
      nameRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setNameDraft(null);
      nameRef.current?.blur();
    }
  }

  function handleFormulaKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit(e.shiftKey ? 'up' : 'down');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      onCommit(e.shiftKey ? 'left' : 'right');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }

  function handleFxClick() {
    if (!onOpenWizard) return;
    const el = inputRef.current;
    const current = el?.value ?? value;
    onOpenWizard({
      currentFormula: current,
      onInsert: (formula: string) => {
        if (el) { el.value = formula; }
        onChange(formula);
      },
    });
  }

  return (
    <div className="flex items-stretch h-[26px] border-y border-[#d0d7de] bg-white">
      <input
        ref={nameRef}
        value={nameDraft ?? cellRef}
        onChange={(e) => setNameDraft(e.target.value)}
        onFocus={handleNameFocus}
        onBlur={handleNameBlur}
        onKeyDown={handleNameKeyDown}
        className="w-[68px] flex-none flex items-center justify-center text-[12px] text-center border-r border-[#d0d7de] hover:bg-bg-subtle font-mono outline-none bg-transparent px-1"
        spellCheck={false}
        aria-label="Name Box"
      />
      <button
        onClick={handleFxClick}
        className="w-9 flex items-center justify-center text-[13px] italic text-text-muted border-r border-[#d0d7de] select-none hover:bg-bg-subtle transition-colors"
        title="Insert function (Function Wizard)"
        type="button"
      >
        fx
      </button>
      <input
        ref={inputRef}
        defaultValue={value}
        onFocus={(e) => {
          if (!editing) onFocus();
          const el = e.currentTarget;
          requestAnimationFrame(() => {
            if (!el) return;
            const len = el.value.length;
            el.setSelectionRange(len, len);
          });
        }}
        onBlur={(e) => {
          savedCursorRef.current = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
        }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleFormulaKeyDown}
        className="flex-1 px-2 text-[13px] bg-transparent outline-none font-mono"
        placeholder=""
        spellCheck={false}
      />
    </div>
  );
});
