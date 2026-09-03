import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES,
  checkAttachment,
  describeSize,
  isAllowedType,
  isPreviewable,
  normalizeContentType,
  sanitizeFilename,
  storageKey,
} from './attachments';

/**
 * These rules run twice — once in the browser before a byte is sent, once in
 * the service before a URL is signed — so what is pinned here is the behaviour
 * both sides depend on being identical.
 */

describe('content types', () => {
  it('ignores the charset a browser appends', () => {
    expect(normalizeContentType('text/plain;charset=utf-8')).toBe('text/plain');
    expect(isAllowedType('text/plain;charset=UTF-8')).toBe(true);
  });

  /**
   * SVG is an image and is still refused: it is a document that can carry
   * script, the one place a viewer opens an attachment is a browser, and the
   * development driver serves bytes from the app's own origin.
   */
  it('refuses the image formats that are documents', () => {
    expect(isAllowedType('image/svg+xml')).toBe(false);
    expect(isAllowedType('text/html')).toBe(false);
    expect(isAllowedType('application/x-msdownload')).toBe(false);
  });

  it('previews rasters only, from within the allowlist', () => {
    expect(isPreviewable('image/png')).toBe(true);
    expect(isPreviewable('application/pdf')).toBe(false);
    // Allowed to upload from a phone, but not something a browser will draw.
    expect(isAllowedType('image/heic')).toBe(true);
    expect(isPreviewable('image/heic')).toBe(false);
  });
});

describe('filenames', () => {
  it('is not a path', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('etc passwd');
    expect(sanitizeFilename('C:\\Users\\me\\report.pdf')).toBe('C: Users me report.pdf');
  });

  it('cannot break out of a Content-Disposition header', () => {
    expect(sanitizeFilename('in"voice.pdf')).toBe('invoice.pdf');
    expect(sanitizeFilename("o'clock.png")).toBe('oclock.png');
  });

  it('refuses a name that hides itself, and a name that is nothing', () => {
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('   ')).toBe('');
    expect(sanitizeFilename('///')).toBe('');
  });

  /**
   * §13. Cutting UTF-16 units splits a Khmer cluster between its base and its
   * diacritic, and what renders is a dotted circle where the letter was. The
   * extension survives because it is what an operating system opens the file
   * with.
   */
  it('truncates by grapheme and keeps the extension', () => {
    const khmer = 'ភ្នំពេញ'.repeat(40);
    const result = sanitizeFilename(`${khmer}.pdf`);

    expect(result.endsWith('.pdf')).toBe(true);
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(result)].length)
      .toBeLessThanOrEqual(120);
    // Nothing was cut mid-cluster: every combining mark still has its base.
    expect(result.startsWith('ភ្នំពេញ')).toBe(true);
  });

  it('leaves an ordinary name alone', () => {
    expect(sanitizeFilename('Q3 report (final).pdf')).toBe('Q3 report (final).pdf');
  });
});

describe('checkAttachment', () => {
  const ok = { filename: 'shot.png', contentType: 'image/png', sizeBytes: 1024 };

  it('accepts a real file', () => {
    expect(checkAttachment(ok)).toBeNull();
  });

  it('names each refusal as an identifier, never a sentence', () => {
    expect(checkAttachment({ ...ok, sizeBytes: 0 })).toBe('file_empty');
    expect(checkAttachment({ ...ok, sizeBytes: MAX_ATTACHMENT_BYTES + 1 })).toBe('file_too_large');
    expect(checkAttachment({ ...ok, contentType: 'image/svg+xml' })).toBe('file_type');
    expect(checkAttachment({ ...ok, filename: '   ' })).toBe('filename_required');
  });

  it('accepts a file exactly at the limit', () => {
    expect(checkAttachment({ ...ok, sizeBytes: MAX_ATTACHMENT_BYTES })).toBeNull();
  });
});

describe('describeSize', () => {
  /**
   * A number and a unit *key*, never a formatted string: the digits are pinned
   * to Latin in both locales and the unit is a translated word (§13).
   */
  it('returns a value and a unit, not a sentence', () => {
    expect(describeSize(512)).toEqual({ value: 512, unit: 'bytes' });
    expect(describeSize(2048)).toEqual({ value: 2, unit: 'kb' });
    expect(describeSize(1024 * 1024 * 3.25)).toEqual({ value: 3.3, unit: 'mb' });
  });
});

describe('storageKey', () => {
  /**
   * Derived from ids only. Two people uploading `screenshot.png` to one item
   * cannot collide, and nothing a person typed ever becomes a path.
   */
  it('is workspace-prefixed and carries no user input', () => {
    const key = storageKey({ workspaceId: 'ws-1', attachmentId: 'att-1' });

    expect(key).toBe('w/ws-1/a/att-1');
    expect(key).not.toContain('.');
  });
});
