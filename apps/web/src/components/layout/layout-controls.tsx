'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Check,
  Columns2,
  LayoutGrid,
  PanelLeft,
  RotateCcw,
  Rows2,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useLayoutStore } from '@/stores/layout-store';
import { cn } from '@/lib/utils';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

/** VSCode-style layout controls: sidebar toggle, split editor, customize menu. */
export function LayoutControls() {
  const pathname = usePathname();
  const sidebarHidden = useUIStore((s) => s.sidebarHidden);
  const toggleSidebarVisibility = useUIStore((s) => s.toggleSidebarVisibility);
  const splitActive = useLayoutStore((s) => s.splitActive);
  const isSplit = useLayoutStore((s) => s.root.type === 'split');
  const reset = useLayoutStore((s) => s.reset);
  const splitRight = () => splitActive('right', pathname);
  const splitDown = () => splitActive('down', pathname);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        active={!sidebarHidden}
        onClick={toggleSidebarVisibility}
        title={`Toggle Primary Side Bar (${mod}+B)`}
      >
        <PanelLeft className="w-4 h-4" />
      </IconButton>

      <IconButton
        onClick={splitRight}
        title={`Split Editor Right (${mod}+\\)\nAlt = Split Editor Down`}
      >
        <Columns2 className="w-4 h-4" />
      </IconButton>

      <div className="relative" ref={menuRef}>
        <IconButton
          active={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          title="Customize Layout…"
        >
          <LayoutGrid className="w-4 h-4" />
        </IconButton>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-2 w-[248px] bg-bg-card border border-border rounded-md shadow-lg p-1 z-50 animate-slide-up">
            <MenuHeader>Visibility</MenuHeader>
            <MenuItem
              icon={<PanelLeft className="w-3.5 h-3.5" />}
              label="Primary Side Bar"
              hint={`${mod}+B`}
              checked={!sidebarHidden}
              onClick={toggleSidebarVisibility}
            />

            <MenuHeader>Editor Layout</MenuHeader>
            <MenuItem
              icon={<Columns2 className="w-3.5 h-3.5" />}
              label="Split Right"
              hint={`${mod}+\\`}
              onClick={() => {
                splitRight();
                setMenuOpen(false);
              }}
            />
            <MenuItem
              icon={<Rows2 className="w-3.5 h-3.5" />}
              label="Split Down"
              hint={`Alt+${mod}+\\`}
              onClick={() => {
                splitDown();
                setMenuOpen(false);
              }}
            />
            {isSplit && (
              <MenuItem
                icon={<RotateCcw className="w-3.5 h-3.5" />}
                label="Reset Editor Layout"
                onClick={() => {
                  reset();
                  setMenuOpen(false);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'w-9 h-9 rounded-sm flex items-center justify-center text-text-muted transition-colors duration-[var(--dur)] hover:bg-bg-hover hover:text-text',
        active && 'text-text bg-bg-hover',
      )}
    >
      {children}
    </button>
  );
}

function MenuHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[.08em] text-text-muted">
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  checked,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm text-[13px] text-text-sub hover:bg-bg-hover hover:text-text"
    >
      <span className="flex-shrink-0 text-text-muted">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {hint && (
        <kbd className="font-mono text-[10px] bg-bg-hover border border-border rounded px-1 py-px text-text-muted">
          {hint}
        </kbd>
      )}
      {checked !== undefined && (
        <Check
          className={cn('w-3.5 h-3.5', checked ? 'text-accent' : 'opacity-0')}
        />
      )}
    </button>
  );
}
