/**
 * What may be attached to a work item, and how its name and size are shown
 * (§7.7, §2.4 — slice 8).
 *
 * In `lib` for the reason `mentions.ts`, `recipients.ts` and `slug.ts` are:
 * **both sides run it.** The composer refuses an oversized file in the browser
 * before a byte leaves the machine, and the server refuses the same file again
 * when it is asked to sign an upload for it. One implementation, so the box
 * cannot accept something the ticket will reject — and the browser check is a
 * courtesy, never the enforcement. The enforcement is in three places: the
 * service, the `content-length` signed into the upload URL (which the store
 * itself checks), and the row that has to exist before any byte is accepted.
 */

/**
 * 25 MiB.
 *
 * Chosen against §2.5 rather than against what a disk can hold: this is a
 * phone-heavy market (§2.5-3) where data costs money (§2.5-5), and the files
 * §2.4 is actually about are a screenshot, a photo of a whiteboard, a scanned
 * contract. 25 MiB clears all three with room to spare and still refuses the
 * video that would cost one person a data plan to upload and every viewer
 * another to open. A larger ceiling is a settings decision (§6-1), not a
 * constant to raise quietly.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Long enough for a real document name, short enough to render in a row. */
export const MAX_FILENAME_GRAPHEMES = 120;

/**
 * What the store will accept, by media type.
 *
 * An allowlist rather than a blocklist, because a blocklist is a promise to
 * have thought of everything. Three notes on what is *not* here:
 *
 *   * **SVG is refused**, though it is an image. An SVG is a document that can
 *     carry script, and the one place a viewer opens an attachment is a
 *     browser. The development driver serves bytes from the app's own origin,
 *     so an allowed SVG would be stored XSS on a machine a developer is signed
 *     in on. A picture is a raster format here.
 *   * **HTML is refused** for the same reason.
 *   * **`zip` is allowed** — a folder of documents is a real thing to send a
 *     colleague, and it is opened by the operating system rather than by us.
 */
const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/** The types a thumbnail is drawn for. A raster subset of the allowlist. */
const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/**
 * A media type as the allowlist sees it: lowercased, with any `; charset=…`
 * parameter dropped. A browser sends `text/plain;charset=utf-8` for a pasted
 * text file, and comparing that whole string against the set would refuse it.
 */
export function normalizeContentType(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

export function isAllowedType(contentType: string): boolean {
  return ALLOWED_TYPES.has(normalizeContentType(contentType));
}

export function isPreviewable(contentType: string): boolean {
  return PREVIEWABLE.has(normalizeContentType(contentType));
}

/** Identifiers, never sentences — the rule every refusal in the product follows (§13). */
export type AttachmentProblem = 'file_empty' | 'file_too_large' | 'file_type' | 'filename_required';

/**
 * The whole check, in one place, run twice.
 *
 * Returns the problem or null rather than throwing, because the composer shows
 * it beside the file that caused it and the service turns it into a refusal —
 * neither wants an exception.
 */
export function checkAttachment(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): AttachmentProblem | null {
  if (!sanitizeFilename(input.filename)) return 'filename_required';
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) return 'file_empty';
  if (input.sizeBytes > MAX_ATTACHMENT_BYTES) return 'file_too_large';
  if (!isAllowedType(input.contentType)) return 'file_type';
  return null;
}

/**
 * A filename that is safe to store, and safe to hand back in a
 * `Content-Disposition` header.
 *
 * A filename arrives from a file picker, a paste, or a hand-written request
 * body, and all three are user input. Four things are removed, and each is a
 * real failure without it: directory separators (a name is not a path, and
 * `../` is not a name), control characters and quotes (which would break out of
 * the header the download is served with), leading dots (a name that hides
 * itself in a listing), and length.
 *
 * **Truncation is grapheme-aware** (§13): slicing UTF-16 units cuts a Khmer
 * cluster between its base and its diacritic, and what renders is a dotted
 * circle where the letter was.
 */
export function sanitizeFilename(raw: string): string {
  const flattened = raw
    .normalize('NFC')
    .replace(/[\\/]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f"']+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim();

  if (!flattened) return '';
  return truncateGraphemes(flattened, MAX_FILENAME_GRAPHEMES);
}

/**
 * Cut to a grapheme count, keeping the extension.
 *
 * The extension is preserved because it is what an operating system opens the
 * file with — a truncation producing `report-for-the-quarterly` instead of
 * `report-for-th….pdf` hands somebody a file their machine cannot open.
 */
function truncateGraphemes(value: string, limit: number): string {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const graphemes = [...segmenter.segment(value)].map((entry) => entry.segment);
  if (graphemes.length <= limit) return value;

  // A short trailing `.xyz` is an extension; a dot at position 3 of a
  // 200-character name is punctuation somebody typed. Matched rather than
  // sliced at an index, so no index into a string is ever taken.
  const extension = /\.[^.\s]{1,11}$/.exec(value)?.[0] ?? '';
  const keep = Math.max(1, limit - [...segmenter.segment(extension)].length);

  return graphemes.slice(0, keep).join('') + extension;
}

/**
 * A byte count as a number and a unit *key*, never as a formatted string.
 *
 * The formatting is the caller's, because it is locale work: the digits are
 * pinned to Latin in both languages (`src/i18n/request.ts`) and the unit is a
 * translated word. Returning "1.4 MB" from here would be the one size label in
 * the product that stayed English in a Khmer workspace (§13).
 */
export function describeSize(bytes: number): { value: number; unit: 'bytes' | 'kb' | 'mb' } {
  if (bytes < 1024) return { value: bytes, unit: 'bytes' };
  if (bytes < 1024 * 1024) return { value: Math.round(bytes / 1024), unit: 'kb' };
  return { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: 'mb' };
}

/**
 * Where the bytes live in the bucket.
 *
 * Workspace-first, so a prefix listing is one tenant's data and nothing else —
 * and the attachment id rather than the filename, so two people uploading
 * `screenshot.png` to the same item cannot collide and so that a key is never
 * derived from user input at all. The original name lives in the row, which is
 * where the download hands it back from.
 */
export function storageKey(input: { workspaceId: string; attachmentId: string }): string {
  return `w/${input.workspaceId}/a/${input.attachmentId}`;
}
