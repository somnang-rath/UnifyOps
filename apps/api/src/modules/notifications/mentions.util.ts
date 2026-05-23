const MENTION_RE = /(?:^|\W)@([a-zA-Z0-9._-]+)/g;

export function extractMentionTokens(body: string | null | undefined): string[] {
  if (!body) return [];
  const out = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    if (m[1]) out.add(m[1].toLowerCase());
  }
  return Array.from(out);
}

export function newMentions(
  prevBody: string | null | undefined,
  nextBody: string | null | undefined,
): string[] {
  const prev = new Set(extractMentionTokens(prevBody));
  return extractMentionTokens(nextBody).filter((t) => !prev.has(t));
}
