'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReportElement } from '@/schemas/report';
import { Wifi, Code2 } from 'lucide-react';
import { runScript } from '@/lib/reports/script-runner';

interface Props {
  element: ReportElement;
  isEditing: boolean;
  onStartEdit: () => void;
  onChange: (props: Record<string, unknown>) => void;
}

export function ElementText({ element, isEditing, onStartEdit, onChange }: Props) {
  const p = element.props as {
    content?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
    textAlign?: 'left' | 'center' | 'right';
    lineHeight?: number;
    letterSpacing?: number;
    fontFamily?: string;
    background?: string;
    paddingX?: number;
    paddingY?: number;
    textDataSource?: { url: string };
    scriptEnabled?: boolean;
    customScript?: string;
    autoWidth?: boolean;
  };

  const isLive   = !!p.textDataSource?.url;
  const hasScript = !!(p.scriptEnabled && p.customScript);

  const ref = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (isEditing && ref.current) {
      setEditing(true);
      requestAnimationFrame(() => {
        if (!ref.current) return;
        ref.current.focus();
        const range = document.createRange();
        range.selectNodeContents(ref.current);
        range.collapse(false);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      });
    } else {
      setEditing(false);
    }
  }, [isEditing]);

  // Auto-width: measure natural text width and push _w back up
  useEffect(() => {
    if (!p.autoWidth || !measureRef.current) return;
    const padX = (p.paddingX ?? 0) * 2;
    const naturalW = measureRef.current.scrollWidth + padX + 4;
    onChangeRef.current({ ...p, _w: naturalW });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoWidth, p.content, p.fontSize, p.fontFamily, p.bold, p.italic, p.letterSpacing, p.paddingX]);

  // Evaluate custom script to override displayed content
  const scriptResult = hasScript && !editing
    ? runScript(p.customScript!, {
        value: p.content ?? null,
        data:  p.textDataSource ?? null,
        rows:  [],
        id:    element.id,
        type:  element.type,
        props: element.props,
      })
    : null;

  const displayContent = scriptResult ?? p.content ?? '';

  const style: React.CSSProperties = {
    fontSize: p.fontSize ?? 14,
    fontWeight: p.bold ? 700 : 400,
    fontStyle: p.italic ? 'italic' : 'normal',
    textDecoration: p.underline ? 'underline' : 'none',
    color: scriptResult?.startsWith('[Script Error') ? '#ef4444' : (p.color ?? '#111111'),
    textAlign: p.textAlign ?? 'left',
    lineHeight: p.lineHeight ?? 1.5,
    letterSpacing: p.letterSpacing ? `${p.letterSpacing}px` : undefined,
    fontFamily: p.fontFamily ?? 'inherit',
    backgroundColor: p.background ?? 'transparent',
    padding: `${p.paddingY ?? 0}px ${p.paddingX ?? 0}px`,
    width: '100%',
    height: '100%',
    outline: 'none',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflow: 'hidden',
    cursor: editing ? 'text' : 'default',
    userSelect: editing ? 'text' : 'none',
  };

  const placeholder =
    '<span style="color:#aaa;font-style:italic;font-weight:400">Double-click to edit…</span>';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Hidden node used to measure natural text width when autoWidth is on */}
      {p.autoWidth && (
        <div
          ref={measureRef}
          aria-hidden
          style={{
            ...style,
            position: 'absolute',
            top: 0,
            left: 0,
            width: 'auto',
            height: 'auto',
            whiteSpace: 'nowrap',
            visibility: 'hidden',
            pointerEvents: 'none',
            overflow: 'visible',
            padding: 0,
          }}
        >
          {displayContent || ''}
        </div>
      )}
      <div
        ref={ref}
        contentEditable={editing}
        suppressContentEditableWarning
        style={style}
        onDoubleClick={onStartEdit}
        onBlur={(e) => {
          onChange({ ...p, content: e.currentTarget.textContent ?? '' });
          setEditing(false);
        }}
        dangerouslySetInnerHTML={
          editing
            ? undefined
            : { __html: displayContent || placeholder }
        }
      />
      {/* Live datasource badge */}
      {isLive && !editing && (
        <div style={{ position: 'absolute', top: 4, right: hasScript ? 20 : 4 }}
          title={`Live: ${p.textDataSource!.url}`}>
          <Wifi className="w-3 h-3 text-accent-500 opacity-70" />
        </div>
      )}
      {/* Script active badge */}
      {hasScript && !editing && (
        <div style={{ position: 'absolute', top: 4, right: 4 }} title="Custom script active">
          <Code2 className="w-3 h-3 text-violet-500 opacity-70" />
        </div>
      )}
    </div>
  );
}
