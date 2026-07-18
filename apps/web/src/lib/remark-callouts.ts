// Renders GitHub-style admonition blockquotes as colored callout "boxes".
//
//     > [!NOTE] Body text…
//     > [!IMPORTANT] Pinned, must-read note.
//
// A matching blockquote is rewritten into a `<div class="md-callout …">` with a
// title row (emoji + label) prepended, and the `[!TYPE]` marker stripped from the
// body. Non-matching blockquotes are left untouched. Kept dependency-free (manual
// tree walk) to mirror `remark-mentions`.

type AstNode = {
  type: string;
  value?: string;
  children?: AstNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, unknown>;
  };
};

const CALLOUT_META: Record<string, { emoji: string; label: string }> = {
  note: { emoji: 'ℹ️', label: 'Note' },
  tip: { emoji: '💡', label: 'Tip' },
  important: { emoji: '📌', label: 'Important' },
  warning: { emoji: '⚠️', label: 'Warning' },
  caution: { emoji: '🛑', label: 'Caution' },
};

const MARKER_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s?/i;

function firstTextNode(node: AstNode): AstNode | null {
  if (node.type === 'text') return node;
  if (!node.children) return null;
  for (const child of node.children) {
    const found = firstTextNode(child);
    if (found) return found;
  }
  return null;
}

function transformBlockquote(node: AstNode): void {
  const firstPara = node.children?.[0];
  if (!firstPara || firstPara.type !== 'paragraph') return;
  const textNode = firstTextNode(firstPara);
  if (!textNode || typeof textNode.value !== 'string') return;

  const match = MARKER_RE.exec(textNode.value);
  if (!match) return;

  const kind = match[1].toLowerCase();
  const meta = CALLOUT_META[kind];
  if (!meta) return;

  // Drop the `[!TYPE]` marker from the body.
  textNode.value = textNode.value.slice(match[0].length);

  // Render as a div so it bypasses the plain-blockquote styling.
  node.data = {
    hName: 'div',
    hProperties: { className: ['md-callout', `md-callout-${kind}`] },
  };

  // Prepend the title row (emoji + label).
  const title: AstNode = {
    type: 'paragraph',
    data: {
      hName: 'div',
      hProperties: { className: ['md-callout-title'] },
    },
    children: [{ type: 'text', value: `${meta.emoji} ${meta.label}` }],
  };
  node.children = [title, ...(node.children ?? [])];
}

function walk(node: AstNode): void {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === 'blockquote') transformBlockquote(child);
    walk(child);
  }
}

export function remarkCallouts() {
  return (tree: unknown) => {
    walk(tree as AstNode);
  };
}
