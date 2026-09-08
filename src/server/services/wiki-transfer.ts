import 'server-only';

import type { ResolvedActor } from '@/server/auth/context';
import { withActor } from '@/server/db/tenant';
import {
  EXPORT_PAGE_LIMIT,
  fetchPageRefs,
  fetchSpaceExport,
  type ExportPageRow,
} from '@/server/queries/wiki';
import { parsePageIds } from '@/lib/doc-refs';
import { MAX_IMPORT_BYTES, MAX_IMPORT_FILES } from '@/lib/wiki';
import {
  pagePath,
  renderFrontMatter,
  resolveTokens,
  type ExportTarget,
  type PageFrontMatter,
} from '@/server/transfer/markdown';
import { planImport, type PlannedSkip } from '@/server/transfer/plan';
import { readZip, writeZip, ZipError, type ZipEntry } from '@/server/transfer/zip';
import {
  canReadSpace,
  checkSpaceWrite,
  loadSpaceBySlug,
  withProject,
} from './space-access';
import { createPageIn, hydrateMentions, setPageTemplateIn, type WikiFailure } from './wiki';

/**
 * Export and import (§21.8 — slice 22).
 *
 * **The argument for this feature is a sales argument, and it is the strongest
 * one in §21.** "§18-7's pilot customer will ask, in some form, what happens to
 * their handbook if they leave — and *a folder of Markdown files and their
 * images, which you can open in any editor* is a better answer than any feature
 * in this section. **A product that is easy to leave is easier to adopt.**"
 *
 * Both directions live in one module because they are one contract. The front
 * matter one writes is the front matter the other reads, and splitting them
 * across two files is how a round trip acquires two definitions of what a page
 * file is — the failure §21.13 makes this slice's definition of done: "export a
 * space, import it into an empty workspace, and the two trees match."
 *
 * Three properties of the pair are worth having before the code:
 *
 * **The export is what a reader sees, in text.** Every token resolution follows
 * `document-body.tsx`'s own fallbacks (see `resolveTokens`), because an export
 * that disagreed with the product about what a document contains would be worse
 * than no export.
 *
 * **The import creates ordinary pages through the ordinary function.**
 * `createPageIn` validates, allocates a free slug, writes the first revision,
 * emits `wiki_page.created` and syncs the body's links and refs. An importer
 * that inserted rows itself would be a second implementation of "what it means
 * to create a page", and it would be the one that forgot the revision.
 *
 * **Nothing about a person is restored.** An owner and a verifier are carried
 * *out* as names, for a human to read, and are never carried back in — see
 * `importSpace`. That is the single most important refusal in this module.
 */

type Ok<T = Record<never, never>> = { ok: true } & T;

export type TransferFailure =
  | WikiFailure
  /** §7.13: a view-as session may not take a copy of the company out (see below). */
  | 'read_only'
  /** More pages than `EXPORT_PAGE_LIMIT`, or an upload over `MAX_IMPORT_BYTES`. */
  | 'too_large'
  /** The upload is not a zip and not Markdown, or the zip will not read. */
  | 'unreadable'
  /** A zip with nothing in it this importer recognises as a page. */
  | 'nothing_to_import';

type Failed = { ok: false; problem: TransferFailure };

/* ------------------------------------------------------------------------- */
/* Export                                                                    */
/* ------------------------------------------------------------------------- */

export type SpaceExport = {
  filename: string;
  /**
   * The archive, base64.
   *
   * **Base64 through a server action rather than bytes through a route
   * handler**, and the constraint is §21's own: its impact table says "Adds to
   * §8's route handlers: **None.** §8's five exceptions stay five." A download
   * endpoint would have been a sixth, and the five are drag-and-drop reorder,
   * list fetch, file upload, webhooks and the future public API — an export is
   * none of them.
   *
   * So the bytes come back inside the action's own result and the browser turns
   * them into a file. The cost is the ~33% base64 adds to a response that is
   * already deflated Markdown; a hundred-page space is a few hundred kilobytes
   * before encoding. The day a page can hold a file (the slice-18 gap named
   * below) that arithmetic changes and this is the line to come back to.
   */
  base64: string;
  pages: number;
};

/**
 * Export one space as a folder of Markdown, in a zip.
 *
 * **Whoever can read the space may export it**, and that is the honest position
 * rather than a lax one: somebody who can read every page can already open them
 * one at a time and paste them somewhere. Requiring write permission would stop
 * nobody and would deny the export to the reader most likely to want it — the
 * person leaving. §21.8 explicitly leaves the question open ("a §6 settings row,
 * a page action, or a departing company's right"), and this is the reading that
 * costs nothing to change later.
 *
 * **Refused inside a view-as session**, which is the one restriction. §7.13's
 * session is somebody looking at the product as a colleague sees it, and taking
 * a copy of the whole company out of one is an act nobody would want attributed
 * to the person being viewed. `can()` denies every `mutation: true` action while
 * `readOnly` is set and there is no §10 action here for it to deny, so the rule
 * is written by hand — exactly as `canCommentInSpace` had to be in slice 21.
 * `uow.emit` would refuse this event anyway; a named refusal is what turns that
 * exception into a sentence.
 */
export async function exportSpace(
  resolved: ResolvedActor,
  spaceSlug: string,
): Promise<Ok<SpaceExport> | Failed> {
  if (resolved.context.readOnly) return { ok: false, problem: 'read_only' } as const;

  return withActor(resolved.context, async (tx, uow) => {
    const space = await loadSpaceBySlug(tx, spaceSlug);
    if (!space) return { ok: false, problem: 'not_found' } as const;

    const context = await withProject(tx, space);
    if (!context || !canReadSpace(resolved.actor, context)) {
      return { ok: false, problem: 'not_found' } as const;
    }

    const rows = await fetchSpaceExport(tx, space.id);
    // `fetchSpaceExport` asks for one more than the limit precisely so this can
    // be a refusal rather than a silent truncation — an export missing its last
    // four hundred pages is the worst possible outcome for a feature whose whole
    // promise is completeness.
    if (rows.length > EXPORT_PAGE_LIMIT) return { ok: false, problem: 'too_large' } as const;

    const paths = pathsFor(rows);

    /*
      Two resolutions, both of ids the bodies carry. Members first, then the
      pages referenced from anywhere in the space — including pages in *other*
      spaces, which resolve to a title with no link because they are not in this
      folder. `fetchPageRefs` is the render path's own query, so a reference
      resolves in a file exactly as it resolves on screen.
    */
    const bodies = rows.map((row) => row.body);
    const members = await hydrateMentions(tx, bodies);

    const referenced = [...new Set(bodies.flatMap((body) => parsePageIds(body)))];
    const refs = referenced.length === 0 ? [] : await fetchPageRefs(tx, referenced);

    const targets: Record<string, ExportTarget> = {};
    for (const ref of refs) {
      targets[ref.id] = { title: ref.title, path: paths.get(ref.id) ?? null };
    }

    const entries: ZipEntry[] = rows.map((row) => {
      const path = paths.get(row.id) as string;
      return {
        path,
        bytes: new TextEncoder().encode(fileFor(row, path, { members, pages: targets })),
      };
    });

    uow.emit({
      type: 'wiki_space.exported',
      workspaceId: resolved.workspace.id,
      spaceId: space.id,
      pages: rows.length,
    });

    return {
      ok: true,
      filename: `${space.slug}.zip`,
      base64: Buffer.from(writeZip(entries)).toString('base64'),
      pages: rows.length,
    } as const;
  });
}

/**
 * Where each page's file goes.
 *
 * Walks parents rather than trusting `depth`, because the path is the *slugs*
 * and only the rows have those. A page whose parent is missing from the set —
 * which cannot happen for a live space, since a parent is never soft-deleted
 * without its children being reparented — falls back to the root rather than
 * looping, so a malformed tree costs a flat folder instead of a hang.
 */
function pathsFor(rows: readonly ExportPageRow[]): Map<string, string> {
  const bySlug = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<string, string>();

  for (const row of rows) {
    const slugs: string[] = [];
    let cursor: ExportPageRow | undefined = row;
    const seen = new Set<string>();

    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      slugs.unshift(cursor.slug);
      cursor = cursor.parentId === null ? undefined : bySlug.get(cursor.parentId);
    }

    paths.set(row.id, pagePath(slugs));
  }

  return paths;
}

/** One page as a file: front matter, a blank line, and the resolved body. */
function fileFor(
  row: ExportPageRow,
  path: string,
  context: { members: Record<string, string>; pages: Record<string, ExportTarget> },
): string {
  const fields: PageFrontMatter = {
    title: row.title,
    icon: row.icon,
    owner: row.ownerName,
    /*
      The *state*, not the raw dates alone. §21.8 asks the block to carry
      "verification state", and a reader who opens one of these files should be
      able to see at a glance whether the page was vouched for — `verified` or
      `never` is that sentence; the dates underneath are the evidence.

      Deliberately not `expiring`/`expired`, which `verificationStatus` derives
      from the workspace's *today*: a file is read on a day nobody can predict,
      and a page stamped "expiring" in the front matter would be wrong within the
      week and could never correct itself. The expiry date is there, and the
      reader's own calendar is the right thing to compare it against.
    */
    verification: row.verifiedAt === null ? 'never' : 'verified',
    verified_by: row.verifiedByName,
    verified_at: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
    verification_expires_at: row.verificationExpiresAt,
    updated_at: row.updatedAt.toISOString(),
    // Only when true. A `template: false` line on every one of two hundred files
    // is noise about a property almost none of them have.
    ...(row.isTemplate ? { template: true } : {}),
  };

  const body = resolveTokens(row.body, { ...context, from: path });
  return `${renderFrontMatter(fields)}\n${body.trimEnd()}\n`;
}

/* ------------------------------------------------------------------------- */
/* Import                                                                    */
/* ------------------------------------------------------------------------- */

/*
  `MAX_IMPORT_BYTES` and `MAX_IMPORT_FILES` live in `src/lib/wiki.ts` because
  both sides run them — the panel names the limit before somebody spends a
  minute uploading, and this module enforces it on the bytes. Re-exported here
  so the action that calls `importSpace` imports its bound from the same place
  it imports the function.
*/
export { MAX_IMPORT_BYTES, MAX_IMPORT_FILES };

export type ImportOutcome = {
  created: number;
  /** Files that were not imported, by path, with why — §7.10's "no rollback". */
  skipped: PlannedSkip[];
};

/**
 * Import Markdown into a space (§21.8).
 *
 * "Import takes Markdown and a zip of it, which is also the interoperability
 * path *from* the survey's own product, since it exports Markdown." So a single
 * `.md` file is a legitimate import of one page, and a zip is a folder of them —
 * one code path, because a single file is a zip of one as far as everything
 * below the first branch is concerned.
 *
 * **Partial success, with a list.** This is §7.10's invitation rule, and it is
 * the right one here for the same reason: a file nested five deep or a body over
 * the cap should not throw away the ninety-nine pages that were fine. The result
 * names what did not land so somebody can fix those files and run it again.
 * There is deliberately no rollback.
 *
 * **Nothing about a person is restored, and this is the refusal that matters.**
 * The front matter carries an owner and a verifier as *names*, which is right
 * for the human reading the folder and useless as an instruction: a name is not
 * an id, the target workspace may not contain that person, and two people may
 * share one. Worse than useless for the verification — §21.3 makes a
 * verification an attributable claim by a member about a particular revision,
 * and writing one from a file would forge exactly the attribution the feature
 * exists to make trustworthy. So an imported page arrives **owned by nobody and
 * never verified**, which is the honest starting point and is precisely what the
 * All-pages view's `unowned` and `unverified` filters exist to find.
 *
 * What *is* restored is what belongs to the page rather than to a person: its
 * title, its body, its place in the tree, its icon and whether it is a template.
 */
export async function importSpace(
  resolved: ResolvedActor,
  input: { spaceSlug: string; filename: string; bytes: Uint8Array },
): Promise<Ok<ImportOutcome> | Failed> {
  if (input.bytes.byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, problem: 'too_large' } as const;
  }

  let files: ZipEntry[];
  try {
    files = filesFrom(input.filename, input.bytes);
  } catch (error) {
    if (error instanceof ZipError) return { ok: false, problem: 'unreadable' } as const;
    throw error;
  }

  if (files.length === 0) return { ok: false, problem: 'nothing_to_import' } as const;
  if (files.length > MAX_IMPORT_FILES) return { ok: false, problem: 'too_large' } as const;

  const plan = planImport(files);
  if (plan.pages.length === 0) return { ok: false, problem: 'nothing_to_import' } as const;

  return withActor(resolved.context, async (tx, uow) => {
    const space = await loadSpaceBySlug(tx, input.spaceSlug);
    if (!space) return { ok: false, problem: 'not_found' } as const;

    const context = await withProject(tx, space);
    if (!context) return { ok: false, problem: 'not_found' } as const;

    const refusal = checkSpaceWrite(resolved.actor, context);
    if (refusal !== null) return { ok: false, problem: refusal } as const;

    const skipped = [...plan.skipped];
    const created = new Map<string, string>();

    /*
      In tree order — every parent before its children — which `planFor`
      guarantees by sorting on depth. `createPageIn` needs a parent *id*, and the
      only way to have one is to have made the parent already. Sequential rather
      than concurrent because a transaction is one client on one socket
      (`sequence.ts`): `Promise.all` here would queue on `pg` and, from version
      9, fail.
    */
    for (const page of plan.pages) {
      const parentId = page.parentPath === null ? null : (created.get(page.parentPath) ?? null);

      // A child whose parent was itself refused. Recording it as skipped is more
      // useful than silently promoting it to a root page in a tree it does not
      // belong at the top of.
      if (page.parentPath !== null && parentId === null) {
        skipped.push({ path: page.path, reason: 'refused' });
        continue;
      }

      const result = await createPageIn(tx, uow, resolved, {
        spaceId: space.id,
        parentId,
        title: page.title,
        body: page.body,
      });

      if (!result.ok) {
        skipped.push({
          path: page.path,
          reason: result.problem === 'body_too_long' ? 'body_too_long' : 'refused',
        });
        continue;
      }

      created.set(page.path, result.pageId);
    }

    /*
      §21.7's flag, applied in a second pass and inside the same transaction.

      **After every page exists, and it cannot be otherwise.** Flagging a page
      while its children are still to be created would make every one of those
      children violate 0040's "nothing nests under a template" — which is a
      trigger, so it would abort the whole import over a filing detail rather
      than skip one file.

      `createPageIn` deliberately takes no `isTemplate`: a template is a page
      with a flag, and the flag is set by the function that owns §21.7's two
      refusals. That is what makes a file claiming `template: true` for a page
      that turned out to have children a **skip with a reason** rather than a
      constraint violation reaching a screen.
    */
    for (const page of plan.pages) {
      if (!page.isTemplate) continue;
      const pageId = created.get(page.path);
      if (pageId === undefined) continue;

      const flagged = await setPageTemplateIn(tx, uow, resolved, { pageId, isTemplate: true });
      if (!flagged.ok) skipped.push({ path: page.path, reason: 'not_a_template' });
    }

    uow.emit({
      type: 'wiki_space.imported',
      workspaceId: resolved.workspace.id,
      spaceId: space.id,
      created: created.size,
      skipped: skipped.length,
    });

    return { ok: true, created: created.size, skipped } as const;
  });
}

/**
 * The uploaded bytes as a list of files.
 *
 * A `.md` upload is wrapped as a one-entry archive rather than given its own
 * branch, so everything downstream — the tree, the front matter, the skip list —
 * has exactly one shape to handle. A zip is read as a zip. Anything else is
 * refused here rather than being sniffed: guessing at a `.docx` is how a bespoke
 * parser and a permanent support obligation begin, which §21.8 refuses in as
 * many words.
 */
function filesFrom(filename: string, bytes: Uint8Array): ZipEntry[] {
  const name = filename.toLowerCase();

  if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt')) {
    return [{ path: filename, bytes }];
  }

  if (name.endsWith('.zip')) {
    return readZip(bytes).filter((entry) => isMarkdown(entry.path));
  }

  throw new ZipError('not_a_zip');
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}
