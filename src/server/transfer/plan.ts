import {
  MAX_PAGE_BODY_LENGTH,
  MAX_PAGE_DEPTH,
  normalizePageTitle,
} from '@/lib/wiki';
import { parseFrontMatter, titleFromFilename, titleFromMarkdown } from './markdown';
import type { ZipEntry } from './zip';

/**
 * Turning a folder of files into a tree of pages (§21.8 — slice 22).
 *
 * **Pure, and beside the parser rather than inside the service**, because every
 * decision here is about *paths and text* and none of them is about the
 * database. The import service opens a transaction and creates pages; this
 * decides what pages there are. Split that way the interesting half — a zip
 * written on Windows, wrapped in its own folder, four levels deep, with a
 * `.DS_Store` in it — is a unit test rather than a fixture with a Postgres
 * behind it.
 *
 * The rule the whole module follows: **a file is a page and a folder is that
 * page's children.** That is the convention `pagePath` writes, and reading it
 * back needs nothing beyond stripping the extension. An `index.md` convention
 * would have needed a rule here about a folder containing both an `index.md`
 * and a page called *index*, and every answer to that is something somebody has
 * to be told.
 */

export type PlannedSkip = {
  path: string;
  reason: 'too_deep' | 'body_too_long' | 'not_a_template' | 'refused';
};

export type PlannedPage = {
  path: string;
  parentPath: string | null;
  title: string;
  body: string;
  isTemplate: boolean;
};

/**
 * Turn a list of files into a list of pages, parents first.
 *
 * **A folder is a page's children, and the file beside it is the page.** That is
 * the convention `pagePath` writes, and reading it back needs no rule beyond
 * stripping `.md`: `handbook/onboarding.md`'s parent is whatever produced
 * `handbook`. An `index.md` convention would have needed a rule here about what
 * a folder containing both an `index.md` and a page called *index* means, and
 * every answer to that is something somebody has to be told.
 *
 * **A folder with no file beside it becomes a page anyway.** A zip from
 * somewhere else may well have `Handbook/onboarding.md` and no `Handbook.md`,
 * and the alternatives are both bad: dropping the children loses most of the
 * import, and flattening them loses the structure that made the folder worth
 * keeping. A placeholder page named after the folder is a real thing a wiki
 * holds — §20.11: "an empty page reads as empty, not as broken" — and somebody
 * can write it or delete it in one click.
 *
 * Depth is capped at §20.4's three levels. Deeper files are skipped rather than
 * flattened, because a page silently moved three levels up is a page nobody can
 * find and nobody was told about.
 */
export function planImport(files: readonly ZipEntry[]): {
  pages: PlannedPage[];
  skipped: PlannedSkip[];
} {
  const decoder = new TextDecoder();
  const skipped: PlannedSkip[] = [];
  const byPath = new Map<string, PlannedPage>();

  /*
    A zip written on Windows uses backslashes, and every platform adds files
    nobody asked for. Neither is a fact about the document tree.
  */
  const normalized = files
    .map((file) => ({ file, path: normalizePath(file.path) }))
    .filter((entry) => entry.path.length > 0 && !isJunk(entry.path));

  for (const entry of normalized) {
    const path = entry.path;
    const key = path.replace(/\.(md|markdown|txt)$/i, '');
    const segments = key.split('/');

    if (segments.length > MAX_PAGE_DEPTH) {
      skipped.push({ path, reason: 'too_deep' });
      continue;
    }

    const text = decoder.decode(entry.file.bytes);
    const { fields, body } = parseFrontMatter(text);

    if (body.length > MAX_PAGE_BODY_LENGTH) {
      skipped.push({ path, reason: 'body_too_long' });
      continue;
    }

    const declared = normalizePageTitle(fields.title ?? '');
    const title =
      declared.length > 0
        ? declared
        : titleFromMarkdown(body, titleFromFilename(segments[segments.length - 1] as string));

    byPath.set(key, {
      path: key,
      parentPath: segments.length === 1 ? null : segments.slice(0, -1).join('/'),
      // A file with no title anywhere — no front matter, no heading, and a name
      // that reduces to nothing — still becomes a page, because it still has a
      // body somebody wrote. `createPageIn` would refuse an empty title, so the
      // filename's raw form is the last resort before that.
      title: title.length > 0 ? title : (segments[segments.length - 1] as string),
      body,
      isTemplate: fields.template === 'true',
    });
  }

  // Folders with no file of their own. Inserted after the pass above so a real
  // file always wins over a placeholder, whichever order the archive listed them
  // in.
  for (const key of [...byPath.keys()]) {
    let parent = (byPath.get(key) as PlannedPage).parentPath;
    while (parent !== null && !byPath.has(parent)) {
      const segments = parent.split('/');
      byPath.set(parent, {
        path: parent,
        parentPath: segments.length === 1 ? null : segments.slice(0, -1).join('/'),
        title: titleFromFilename(segments[segments.length - 1] as string),
        body: '',
        isTemplate: false,
      });
      parent = segments.length === 1 ? null : segments.slice(0, -1).join('/');
    }
  }

  const pages = [...byPath.values()].sort((a, b) => {
    const depth = a.path.split('/').length - b.path.split('/').length;
    return depth !== 0 ? depth : a.path.localeCompare(b.path);
  });

  return { pages, skipped };
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    // `..` in an archive path is the classic zip-slip, and it is meaningless
    // here even when it is innocent: nothing is written to a filesystem, but a
    // path that climbs out of the archive would compute a parent that is not in
    // it. Dropping the segments is the whole defence.
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');
}

/** macOS and Windows both add files nobody asked for. */
function isJunk(path: string): boolean {
  return (
    path.startsWith('__MACOSX/') ||
    path.split('/').some((segment) => segment === '.DS_Store' || segment.startsWith('._'))
  );
}

/*
 * **There is deliberately no "strip the wrapping folder" step, and the absence
 * is a decision.**
 *
 * Unzipping an export and zipping the *folder* back up wraps everything in that
 * folder's name — `handbook-export/handbook.md` — and it is tempting to detect
 * the single shared top-level directory and remove it. The trouble is that the
 * shape is indistinguishable from a real one: an archive holding only
 * `runbooks/deploy.md` has exactly the same single shared directory, and there
 * it is a *page* with a child rather than packaging. No rule over paths can tell
 * the two apart, because the difference is in what somebody meant.
 *
 * So neither is guessed at. A wrapper becomes an ordinary page named after the
 * folder, visible in the tree and one click from being deleted — where a wrong
 * guess in the other direction silently moves every page up a level and loses a
 * heading somebody wrote. That is slice 15's rule about the holiday calendar,
 * applied to a folder: **a guessed value is worse than an absent one, because
 * nobody goes looking to check it.** The round trip §21.13 asks for is unharmed
 * either way, because it re-imports the file the export produced rather than a
 * folder somebody rebuilt.
 */
