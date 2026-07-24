'use client';

import * as React from 'react';

/** `classnames`-lite used across the toolbar pieces. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Icon toolbar button (28×28). `anchor` marks it as a popover anchor so the
 * shared outside-click handler (`[data-rte-anchor]`) leaves it alone.
 * `pressed` additionally emits `aria-pressed` for toggle buttons — opt-in so
 * existing RichTextEditor markup stays byte-identical.
 */
export function Btn({
  title,
  active,
  anchor,
  pressed,
  onClick,
  children,
}: React.PropsWithChildren<{
  title: string;
  active?: boolean;
  anchor?: boolean;
  pressed?: boolean;
  onClick: () => void;
}>) {
  return (
    <button
      type="button"
      title={title}
      data-rte-anchor={anchor ? '' : undefined}
      aria-pressed={pressed !== undefined ? pressed : undefined}
      onClick={onClick}
      className={cx('prism-rich-btn', active && 'is-active')}
    >
      {children}
    </button>
  );
}

/** Thin vertical separator between toolbar groups. */
export function Sep() {
  return <span className="prism-rich-sep" />;
}

/** Small labelled control used by the contextual TableBar. */
export function TCtl({
  title,
  onClick,
  danger,
  children,
}: React.PropsWithChildren<{
  title: string;
  onClick: () => void;
  danger?: boolean;
}>) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx('prism-rich-tctl', danger && 'is-danger')}
    >
      {children}
    </button>
  );
}
