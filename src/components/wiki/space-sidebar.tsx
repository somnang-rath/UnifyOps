import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { hasKhmer } from '@/lib/search';
import { buildPageTree, type TreeNode, type TreePage } from '@/lib/wiki';
import type { PageSummary } from '@/server/queries/wiki';

/**
 * One space's page tree (§20.11).
 *
 * **A nested list of links with `aria-current`, not a custom widget** — §20.11
 * says so in as many words, and the reason is §11's baseline: "a list of links
 * has [the whole keyboard loop] for free where a `tree` role has to be given it
 * by hand". A `role="tree"` would owe arrow-key navigation, typeahead,
 * `aria-expanded` on every branch and a roving tabindex, all of which a browser
 * already does for `<a>` inside `<ul>`.
 *
 * A **server** component, so the parse and the locale are resolved where they
 * already are, and no part of the tree reaches the browser as JavaScript.
 *
 * `buildPageTree` is the one place a flat list becomes nesting, and it runs on
 * whichever side asks — the same `src/lib` rule `mentions.ts` and
 * `work-item-query.ts` follow.
 */
export async function SpaceSidebar({
  pages,
  workspaceSlug,
  spaceSlug,
  currentSlug,
  canWrite,
}: {
  pages: PageSummary[];
  workspaceSlug: string;
  spaceSlug: string;
  /** The page being read, so exactly one link carries `aria-current`. */
  currentSlug?: string;
  canWrite: boolean;
}) {
  const t = await getTranslations('wiki');
  const tree = buildPageTree(pages);

  return (
    <nav aria-label={t('sidebar.label')} className="space-y-2">
      {tree.length === 0 ? (
        /*
         * §20.3.2's `[E]`: "a space with no pages → 'Nothing written here yet'
         * and the create action, never a tour." Not an `EmptyState` card — this
         * is a sidebar beside a body that says the same thing more loudly, and
         * two empty states stacked read as a broken screen rather than a new one.
         */
        <p className="px-2 py-1 text-2xs text-text-subtle">{t('sidebar.empty')}</p>
      ) : (
        <Branch
          nodes={tree}
          workspaceSlug={workspaceSlug}
          spaceSlug={spaceSlug}
          currentSlug={currentSlug}
        />
      )}

      {canWrite && (
        <Link
          href={`/${workspaceSlug}/wiki/${spaceSlug}/new`}
          className="block rounded-sm px-2 py-1 text-2xs font-medium text-accent hover:bg-surface-sunken"
        >
          {t('sidebar.newPage')}
        </Link>
      )}
    </nav>
  );
}

function Branch({
  nodes,
  workspaceSlug,
  spaceSlug,
  currentSlug,
}: {
  nodes: TreeNode<TreePage & PageSummary>[] | TreeNode<PageSummary>[];
  workspaceSlug: string;
  spaceSlug: string;
  currentSlug?: string;
}) {
  return (
    <ul className="space-y-0.5">
      {(nodes as TreeNode<PageSummary>[]).map((node) => {
        const active = node.page.slug === currentSlug;

        return (
          <li key={node.page.id}>
            <Link
              href={`/${workspaceSlug}/wiki/${spaceSlug}/${node.page.slug}`}
              /*
               * `aria-current="page"` rather than a class alone: the highlight is
               * what a sighted reader sees and this is what everybody else does.
               * §11's baseline treats the two as one requirement.
               */
              aria-current={active ? 'page' : undefined}
              className={cn(
                'block rounded-sm px-2 py-1 text-xs transition-colors duration-120',
                active
                  ? 'bg-surface-sunken font-medium text-text'
                  : 'text-text-muted hover:bg-surface-sunken hover:text-text',
              )}
              style={{
                // Indent by depth. A padding class per level would be four
                // classes for a three-level cap plus a fifth nobody notices is
                // dead; the value is derived from the same `depth` the database
                // maintains, so the sidebar cannot disagree with the tree.
                paddingInlineStart: `${0.5 + (node.depth - 1) * 0.75}rem`,
              }}
            >
              {/*
               * §20.10: `lang` follows the content, not the page. A Khmer page
               * title in an English workspace clips its diacritics at a Latin
               * line-height, and a sidebar is the tightest slot in the screen.
               *
               * Clamped rather than sliced, because §13 requires grapheme-aware
               * truncation and CSS line-clamp is the one truncation that is
               * correct in every script by construction.
               */}
              <span lang={hasKhmer(node.page.title) ? 'km' : undefined} className="line-clamp-2">
                {node.page.title}
              </span>
            </Link>

            {node.children.length > 0 && (
              <Branch
                nodes={node.children}
                workspaceSlug={workspaceSlug}
                spaceSlug={spaceSlug}
                currentSlug={currentSlug}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
