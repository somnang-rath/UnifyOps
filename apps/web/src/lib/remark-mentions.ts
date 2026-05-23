type AstNode = {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  children?: AstNode[];
};

const MENTION_RE = /(^|\W)@([a-zA-Z0-9._-]+)/g;
const SKIP_TYPES = new Set(['code', 'inlineCode', 'link', 'linkReference']);

function splitMentions(value: string): AstNode[] | null {
  MENTION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let lastIdx = 0;
  const out: AstNode[] = [];
  let found = false;
  while ((m = MENTION_RE.exec(value))) {
    found = true;
    const atIdx = m.index + m[1].length;
    if (atIdx > lastIdx) {
      out.push({ type: 'text', value: value.slice(lastIdx, atIdx) });
    }
    out.push({
      type: 'link',
      url: `#mention-${m[2].toLowerCase()}`,
      title: null,
      children: [{ type: 'text', value: `@${m[2]}` }],
    });
    lastIdx = atIdx + 1 + m[2].length;
  }
  if (!found) return null;
  if (lastIdx < value.length) {
    out.push({ type: 'text', value: value.slice(lastIdx) });
  }
  return out;
}

function walk(node: AstNode): void {
  if (!node.children) return;
  if (SKIP_TYPES.has(node.type)) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'text' && typeof child.value === 'string') {
      const replaced = splitMentions(child.value);
      if (replaced) {
        node.children.splice(i, 1, ...replaced);
        i += replaced.length - 1;
      }
    } else {
      walk(child);
    }
  }
}

export function remarkMentions() {
  return (tree: unknown) => {
    walk(tree as AstNode);
  };
}
