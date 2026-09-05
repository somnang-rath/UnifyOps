import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { hasKhmer } from '@/lib/search';
import {
  parseDocument,
  type BlockNode,
  type CalloutTone,
  type InlineNode,
  type ListItem,
} from '@/lib/documents';

/**
 * A document body, rendered (§20.7).
 *
 * The other half of `src/lib/documents.ts`: that module decides what a body
 * *means*, this one decides what it looks like. Neither ever builds a string of
 * markup, which is what makes §20.7's "raw HTML is refused, not sanitised" a
 * property of the architecture rather than of a filter — there is no
 * `dangerouslySetInnerHTML` here and nothing downstream that could take one.
 *
 * **It carries no `'use client'` and needs none**, which means it renders on
 * whichever side imports it. Slice 18's page reader will render it on the server,
 * like the comment thread and the activity feed — the parse and the locale
 * resolved where they already are. The notes list imports it from a client
 * component, because reading and editing are two states of one expanding row and
 * a server component cannot be toggled into one; the parser goes into that
 * bundle, which is the price of the row not being a route.
 *
 * In `components/ui` rather than in `components/notes`, because slice 18's page
 * reader renders the same bodies through the same parser. A renderer that lived
 * with the first noun to need it would be imported *from* notes by the wiki,
 * which is exactly the coupling §20.1 keeps the two nouns apart to avoid.
 *
 * **This is where §13's per-content language gap is closed for notes**, and the
 * gap itself is older than this slice: it has been open since slice 8, where a
 * Khmer comment in an English workspace inherits `lang="en"` and clips its
 * diacritics. §20.10 asks for it to be closed "for all user content rather than
 * only pages", in slice 18, "because fixing it in one place and not the others
 * is how one gap becomes four". This component does its own share now — a body
 * detected as Khmer gets `lang="km"`, which is what `:lang(km)`'s line-height
 * in `globals.css` keys off — and the comment bodies, item titles and project
 * names are still slice 18's to fix, together.
 */

/** How a mention chip is drawn — the same pair `comment-thread.tsx` uses. */
const MENTION = 'rounded-sm bg-accent-subtle px-1 font-medium text-accent';

export type DocumentContext = {
  /** Member id to display name, for `@[uuid]` (§20.7). Absent names render as nothing. */
  mentioned?: Record<string, string>;
  /**
   * Page id to title and destination, for `#[uuid]` (§20.7) — slice 18.
   *
   * `href: null` means the page exists and is deleted, which §20.3.6 asks to
   * render as its name rather than as a broken link. An id absent from the map
   * entirely is a reference to a page that never existed — a hand-typed token,
   * or one whose page was hard-deleted — and renders as the absence slice 17
   * shipped.
   *
   * A map rather than a resolver function, because this component renders on the
   * server *and* inside the notes list's client bundle: a function would have to
   * be one the client could call, and that is a fetch per token per render.
   */
  pages?: Record<string, { title: string; href: string | null; excerpt?: string }>;
  /**
   * What each callout tone is called, when the writer gave one no title (§21.5).
   *
   * Passed in rather than read from `useTranslations`, because this component
   * renders on the server *and* inside a client bundle — the same reason
   * `mentioned` and `pages` are maps rather than resolvers. Absent, an untitled
   * callout simply has no title bar, which is the right degradation: a body must
   * never render an English word into a Khmer page because a caller forgot
   * something (§13).
   */
  calloutLabels?: Record<CalloutTone, string>;
  /** The workspace an `ENG-142` reference resolves inside. */
  workspaceSlug: string;
};

export function DocumentBody({
  body,
  context,
  className,
}: {
  body: string;
  context: DocumentContext;
  className?: string;
}) {
  const blocks = parseDocument(body);

  return (
    <div
      /**
       * §20.10, and §13's oldest open gap. A body is the longest continuous run
       * of user text in the product, so a Khmer note inside an English workspace
       * is where an inherited `lang` first becomes unignorable: Khmer stacks
       * diacritics vertically and clips at Latin line-heights.
       *
       * `hasKhmer` is the detector, and it is the *same* one `searchRoute` uses
       * — one implementation, so a body that searches as Khmer also renders as
       * Khmer. Undefined rather than `"en"` when there is no Khmer in it,
       * because the page's own `lang` is already right for that case and
       * restating it would override a correct value with a guessed one.
       */
      lang={hasKhmer(body) ? 'km' : undefined}
      className={cn('space-y-3 text-sm text-text', className)}
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} context={context} />
      ))}
    </div>
  );
}

/**
 * One block.
 *
 * The index is a sound key throughout this file: the tree is derived from one
 * immutable body, and nothing is ever reordered or inserted into it.
 */
function Block({ block, context }: { block: BlockNode; context: DocumentContext }) {
  switch (block.kind) {
    case 'heading':
      return (
        <Heading
          level={block.level}
          anchor={block.anchor}
          content={block.content}
          context={context}
        />
      );

    case 'paragraph':
      // `break-words` so a pasted URL cannot push the panel wider than the page
      // at 390px (§15-6) — the rule slice 16's responsive sweep asserts.
      return (
        <p className="break-words leading-relaxed">
          <Inlines nodes={block.content} context={context} />
        </p>
      );

    case 'list':
      return block.ordered ? (
        <ol start={block.start} className="ms-5 list-decimal space-y-1">
          <Items items={block.items} context={context} />
        </ol>
      ) : (
        <ul className="ms-5 list-disc space-y-1">
          <Items items={block.items} context={context} />
        </ul>
      );

    case 'quote':
      // `border-s` rather than `border-l`: a logical property, so the rule sits
      // on the correct side if a right-to-left locale is ever added.
      return (
        <blockquote className="border-s-2 border-border ps-3 text-text-muted">
          {block.children.map((child, index) => (
            <Block key={index} block={child} context={context} />
          ))}
        </blockquote>
      );

    case 'callout':
      return <Callout block={block} context={context} />;

    case 'code':
      return (
        // The one place a horizontal scroller is right: a line of code is not
        // reflowable, and wrapping it changes what it says. Scrolling inside its
        // own box is what keeps the *document* from scrolling sideways, which is
        // the distinction `responsive.spec.ts` asserts.
        <pre className="overflow-x-auto rounded-md bg-surface-sunken p-3 text-xs">
          <code>{block.text}</code>
        </pre>
      );

    case 'rule':
      return <hr className="border-border" />;

    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className={cn(
                      'border-b border-border px-2 py-1 font-medium',
                      alignClass(block.align[index]),
                    )}
                  >
                    <Inlines nodes={cell} context={context} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={cn(
                        'border-b border-border px-2 py-1',
                        alignClass(block.align[index]),
                      )}
                    >
                      <Inlines nodes={cell} context={context} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Items({ items, context }: { items: ListItem[]; context: DocumentContext }) {
  return items.map((item, index) => (
    <li
      key={index}
      /**
       * A to-do carries no marker, because it draws its own box (§21.5).
       * `list-none` with a negative start margin puts the checkbox where the
       * bullet was, so a mixed list still lines up down one edge.
       */
      className={item.checked === null ? undefined : '-ms-5 flex list-none items-baseline gap-2'}
    >
      {item.checked !== null && (
        <input
          type="checkbox"
          checked={item.checked}
          disabled
          /**
           * **Disabled, and read-only in the strongest sense.** This is a
           * document, not a form: the state lives in the body's own text, so a
           * box that could be clicked would either lie (nothing is stored) or
           * silently edit somebody else's page from the reader. Ticking one is
           * editing the line — which is what the editor is for.
           *
           * `aria-hidden` would be wrong: the box *is* the information. It keeps
           * its accessible state and the item's text is its label through the
           * `<li>`, so a screen reader reads "checked, ship the release notes".
           */
          readOnly
          className="shrink-0 accent-accent"
        />
      )}
      <span className={item.checked === null ? undefined : 'min-w-0 flex-1'}>
        <Inlines nodes={item.content} context={context} />
        {item.children.map((child, childIndex) => (
          <Block key={childIndex} block={child} context={context} />
        ))}
      </span>
    </li>
  ));
}

/** How each tone is drawn — the same four `Alert` has carried since slice 1. */
const CALLOUT_TONES: Record<CalloutTone, string> = {
  info: 'border-border bg-surface-sunken',
  success: 'border-success bg-success-subtle',
  warning: 'border-warning bg-warning-subtle',
  danger: 'border-danger bg-danger-subtle',
};

/**
 * A callout, and — when the writer put a `-` after the tag — a toggle (§21.5).
 *
 * **`<details>` rather than a `useState`, and that is what keeps this component
 * server-renderable.** `DocumentBody` carries no `'use client'` on purpose
 * (§20.7), so a toggle built out of state would have forced the whole renderer
 * into every page's bundle to make one triangle work. The platform's own
 * disclosure gives the open/closed state, the keyboard behaviour, the correct
 * ARIA and — the part that matters most in a document — **find-in-page reaching
 * inside a closed one** in browsers that implement it. This is the same call
 * `dialog.tsx` makes for the modal: the alternative is not our own code but the
 * browser's.
 *
 * A callout with no title is named by its tone, translated, rather than left
 * with an empty summary bar. That string is the one word in a body this
 * component supplies, which is why it comes from the catalogue and not from the
 * parser (§13).
 */
function Callout({
  block,
  context,
}: {
  block: Extract<BlockNode, { kind: 'callout' }>;
  context: DocumentContext;
}) {
  const body = block.children.map((child, index) => (
    <Block key={index} block={child} context={context} />
  ));

  const title = block.title ? (
    <Inlines nodes={block.title} context={context} />
  ) : (
    context.calloutLabels?.[block.tone]
  );

  const shell = cn('rounded-md border p-3', CALLOUT_TONES[block.tone]);

  if (!block.folded) {
    return (
      <aside className={cn(shell, 'space-y-2')}>
        {(block.title || context.calloutLabels) && (
          <p className="text-xs font-semibold text-text">{title}</p>
        )}
        {body}
      </aside>
    );
  }

  return (
    <details className={shell}>
      {/*
        `cursor-pointer` and a marker the browser draws. The focus ring is the
        global `:focus-visible` rule — a `<summary>` is focusable already, which
        is half the reason this is a `<details>`.
      */}
      <summary className="cursor-pointer text-xs font-semibold text-text">{title}</summary>
      <div className="mt-2 space-y-2">{body}</div>
    </details>
  );
}

/**
 * Headings start at `h2` and stop at `h4`.
 *
 * The page or panel this body renders inside already owns the `h1` — a note's
 * screen has a heading, and slice 18's page reader will have the page title —
 * so a body that emitted its own would give the document two, which is the
 * single most common accessible-structure defect in rendered Markdown. The
 * clamp is what makes `#` mean "the top level *within this body*" whatever the
 * writer typed.
 */
function Heading({
  level,
  anchor,
  content,
  context,
}: {
  level: number;
  anchor: string;
  content: InlineNode[];
  context: DocumentContext;
}) {
  const inner = <Inlines nodes={content} context={context} />;

  /**
   * The id §21.5's table of contents jumps to.
   *
   * **`scroll-mt-16` is not decoration.** The workspace header is sticky, so a
   * heading scrolled to by fragment lands underneath it — the link works, and
   * the reader is looking at the wrong line with no way to know a jump
   * happened. It is the one place a scroll offset belongs in a document body.
   *
   * `tabIndex={-1}` for the reason slice 16's skip link carries it: a bare
   * fragment link moves the *scroll* and leaves focus where it was in some
   * browsers, so the next Tab goes back into the contents list somebody just
   * used. A programmatically focusable heading takes the focus with the scroll.
   */
  const props = { id: anchor, tabIndex: -1, className: 'scroll-mt-16' } as const;

  if (level <= 1)
    return (
      <h2 {...props} className={cn(props.className, 'text-base font-semibold text-text')}>
        {inner}
      </h2>
    );
  if (level === 2)
    return (
      <h3 {...props} className={cn(props.className, 'text-sm font-semibold text-text')}>
        {inner}
      </h3>
    );
  return (
    <h4 {...props} className={cn(props.className, 'text-sm font-medium text-text')}>
      {inner}
    </h4>
  );
}

function Inlines({ nodes, context }: { nodes: InlineNode[]; context: DocumentContext }) {
  return nodes.map((node, index) => <Inline key={index} node={node} context={context} />);
}

function Inline({ node, context }: { node: InlineNode; context: DocumentContext }) {
  switch (node.kind) {
    case 'text':
      return node.text;

    case 'strong':
      return (
        <strong className="font-semibold">
          <Inlines nodes={node.content} context={context} />
        </strong>
      );

    case 'emphasis':
      return (
        <em className="italic">
          <Inlines nodes={node.content} context={context} />
        </em>
      );

    case 'code':
      return (
        <code className="rounded-xs bg-surface-sunken px-1 text-xs">{node.text}</code>
      );

    case 'link':
      /**
       * A plain `<a>` and not `@/i18n/navigation`'s `Link`, deliberately, and
       * the ESLint rule that bans the bare import is about *route* links.
       * `href` here is arbitrary user text that has already been through
       * `safeHref`; it may be an external URL or a `mailto:`, and prefixing
       * either with a locale would break it. An internal path a person pasted
       * already carries its own locale, because that is what the address bar
       * showed them.
       *
       * `rel="noreferrer"` on every one rather than only on the external ones,
       * because deciding which is which means parsing the URL again to answer a
       * question the attribute costs nothing to answer for both.
       */
      return (
        <a
          href={node.href}
          rel="noreferrer"
          className="text-accent underline underline-offset-2"
        >
          <Inlines nodes={node.content} context={context} />
        </a>
      );

    case 'image':
      /**
       * A plain `<img>` rather than `next/image`, because the source is user
       * text: `next/image` needs configured remote patterns and a known
       * intrinsic size, and neither exists for a URL somebody typed. Sized by
       * CSS so an image cannot push a 390px screen sideways.
       */
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={node.src} alt={node.alt} className="max-w-full rounded-md" />;

    case 'break':
      return <br />;

    case 'mention':
      // The name is resolved from the id at render, never stored (§20.7). An
      // unknown id renders as an empty chip rather than as a uuid: somebody who
      // has left is not a string of hex.
      return <span className={MENTION}>@{context.mentioned?.[node.memberId] ?? ''}</span>;

    case 'pageRef': {
      /**
       * `#[page]`, resolved to a title at render and never stored (§20.7) — the
       * rule `activity.data` and comment mentions already follow, so a page
       * renamed next March reads correctly in a document written today, and a
       * Khmer title is never frozen into a row as English (§13).
       *
       * Three outcomes, which is one more than slice 17 could produce:
       *
       *  - **Resolved and live** → a link to the page.
       *  - **Resolved and deleted** → its name, unlinked (§20.3.6: "the
       *    references render as 'a deleted page' rather than breaking"). Naming
       *    it and refusing to link it is more honest than a link that 404s.
       *  - **Unresolved** → the absence slice 17 shipped, which is the right
       *    rendering of a reference to something that never existed and the same
       *    fallback slice 7 chose for an activity line naming a hard-deleted
       *    workflow state.
       */
      const target = context.pages?.[node.pageId];
      if (!target) return <span className="text-text-subtle">—</span>;

      const label = (
        <span lang={hasKhmer(target.title) ? 'km' : undefined}>{target.title}</span>
      );

      if (target.href === null) {
        return (
          <span className="rounded-xs bg-surface-sunken px-1 text-text-subtle line-through">
            {label}
          </span>
        );
      }

      return (
        <Link
          href={target.href}
          /**
           * §21.4's hover preview, and it is a `title` attribute rather than a
           * popover — which is a decision, not a shortcut.
           *
           * What §21.4 asks for is "the title and the first line of the body,
           * resolved from a row the page has already loaded", and the excerpt is
           * exactly that: it rides `fetchPageRefs`, which this render already
           * ran. A floating card would need this component to become a client
           * one — it carries no `'use client'` on purpose (§20.7), and a
           * reference appears inside running prose, so the cost would be the
           * whole renderer in every bundle to decorate an inline word. The
           * platform's own tooltip is keyboard-reachable, screen-reader-read,
           * positioned by the browser and free at 390px, where a hand-built card
           * anchored to a word mid-paragraph is the thing most likely to push
           * the document sideways (§15-6).
           *
           * `title` and not `aria-label`: a label would *replace* the link's
           * name, so a screen reader would announce the excerpt instead of the
           * page — losing the one word that says where the link goes.
           */
          title={target.excerpt ? `${target.title} — ${target.excerpt}` : undefined}
          className="rounded-xs bg-surface-sunken px-1 font-medium text-accent"
        >
          {label}
        </Link>
      );
    }

    case 'itemRef':
      /**
       * `ENG-142`, linked through the search short-circuit rather than straight
       * to the item.
       *
       * A direct link needs the project's *slug*, and a body only carries its
       * key — so resolving one would mean a key-to-slug lookup for every
       * reference on every screen that renders a body, for a link that is
       * followed rarely. §7.9 already built exactly this lookup and made it
       * unconditional: "a direct `ENG-142` lookup always resolves regardless of
       * either" archived or filtered, and the results screen puts it at the top
       * as the *Exact match* section.
       *
       * It is also the only version that is correct for an identifier that does
       * not resolve — a typo, or an item in a project this reader cannot see.
       * A constructed direct link would 404; this shows "No item ENG-142",
       * which is the true answer.
       */
      return (
        <Link
          href={`/${context.workspaceSlug}/search?q=${encodeURIComponent(
            `${node.key}-${node.number}`,
          )}`}
          className="rounded-xs bg-surface-sunken px-1 font-medium text-accent"
        >
          {node.key}-{node.number}
        </Link>
      );
  }
}

function alignClass(align: 'left' | 'center' | 'right' | null | undefined): string {
  if (align === 'center') return 'text-center';
  if (align === 'right') return 'text-right';
  return 'text-start';
}
