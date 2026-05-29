'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReportElement } from '@/schemas/report';

interface Props {
  element: ReportElement;
  isEditing: boolean;
  onStartEdit: () => void;
  onChange: (props: Record<string, unknown>) => void;
}

export function ElementHeading({ element, isEditing, onStartEdit, onChange }: Props) {
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
    autoWidth?: boolean;
  };

  const ref = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const [editing, setEditing] = useState(false);

  // Auto-width: measure natural text width and push _w back up
  useEffect(() => {
    if (!p.autoWidth || !measureRef.current) return;
    const padX = (p.paddingX ?? 0) * 2;
    const naturalW = measureRef.current.scrollWidth + padX + 4;
    onChangeRef.current({ ...p, _w: naturalW });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.autoWidth, p.content, p.fontSize, p.fontFamily, p.bold, p.italic, p.letterSpacing, p.paddingX]);

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

  const style: React.CSSProperties = {
    fontSize: p.fontSize ?? 28,
    fontWeight: p.bold === false ? 400 : 700,
    fontStyle: p.italic ? 'italic' : 'normal',
    textDecoration: p.underline ? 'underline' : 'none',
    color: p.color ?? '#111111',
    textAlign: p.textAlign ?? 'left',
    lineHeight: p.lineHeight ?? 1.2,
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
          {p.content || ''}
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
          editing ? undefined : { __html: p.content ? p.content : placeholder }
        }
      />
    </div>
  );
}
