export function colA1(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function a1Col(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

export function rcToA1(r: number, c: number): string {
  return colA1(c) + (r + 1);
}

export function a1ToRC(a1: string): { r: number; c: number } | null {
  const m = a1.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { c: a1Col(m[1]), r: parseInt(m[2], 10) - 1 };
}

export function normalizeRange(
  sr: number,
  sc: number,
  er: number,
  ec: number,
): { r1: number; c1: number; r2: number; c2: number } {
  return {
    r1: Math.min(sr, er),
    c1: Math.min(sc, ec),
    r2: Math.max(sr, er),
    c2: Math.max(sc, ec),
  };
}
