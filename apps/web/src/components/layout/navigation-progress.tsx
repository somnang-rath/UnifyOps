'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';

export function NavigationProgress() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPathRef = useRef(pathname);
  const navigatingRef = useRef(false);
  const completeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start bar when any internal link is clicked
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      // Skip external, hash-only, or same-page links
      if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#') || href.startsWith('mailto:')) return;
      // Strip query/hash for comparison
      const targetPath = href.split('?')[0].split('#')[0];
      if (targetPath === pathname) return;

      startProgress();
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [pathname]);

  // Complete bar when pathname actually changes
  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      if (navigatingRef.current) completeProgress();
    }
  }, [pathname]);

  function startProgress() {
    navigatingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (completeRef.current) clearTimeout(completeRef.current);
    setWidth(0);
    setVisible(true);

    let w = 8;
    setWidth(w);
    timerRef.current = setInterval(() => {
      w = w < 65 ? w + Math.random() * 12 : w < 85 ? w + 2 : w < 92 ? w + 0.5 : w;
      setWidth(Math.min(w, 92));
    }, 200);
  }

  function completeProgress() {
    navigatingRef.current = false;
    if (timerRef.current) clearInterval(timerRef.current);
    setWidth(100);
    completeRef.current = setTimeout(() => {
      setVisible(false);
      setWidth(0);
    }, 350);
  }

  if (!visible) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '2px',
        zIndex: 99999,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${width}%`,
          background: 'var(--a)',
          boxShadow: '0 0 10px var(--a), 0 0 4px var(--a)',
          transition:
            width === 100
              ? 'width 220ms cubic-bezier(.4,0,.2,1)'
              : 'width 180ms ease-out',
        }}
      />
    </div>
  );
}
