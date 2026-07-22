'use client';
import { useState } from 'react';

/**
 * Display-only cover for published pages (ADR 0010, spec §7). Plain <img>,
 * not next/image: the cover is an arbitrary hotlinked https URL and routing
 * it through the optimizer would both need a remotePatterns allowlist and
 * conflict with Unsplash's hotlinking guideline.
 *
 * Hotlinked images can disappear — on error the cover vanishes silently
 * (no placeholder on the public surface).
 */
export function SpaceCover({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- hotlinked cover URL (ADR 0010 §3)
    <img
      src={src}
      alt=""
      loading="eager"
      draggable={false}
      onError={() => setBroken(true)}
      className="w-full aspect-[4/1] max-h-[200px] object-cover rounded-lg mb-8"
    />
  );
}
