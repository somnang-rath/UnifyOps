import { describe, expect, it } from 'vitest';
import {
  MAX_NOTE_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  noteTitle,
  notePreview,
  normalizeNoteTitle,
  validateNote,
} from './notes';

describe('validateNote', () => {
  it('refuses an empty body, because a note is its body (§20.3.1)', () => {
    expect(validateNote({ title: null, body: '   \n\n ' })).toBe('body_required');
  });

  it('accepts an ordinary note', () => {
    expect(validateNote({ title: null, body: 'call the supplier back' })).toBeNull();
  });

  it('caps the body by grapheme, not by code point', () => {
    // A Khmer syllable is three or four code points; counted that way this body
    // would be refused while an English one of the same visible length fits.
    const syllable = 'ស្រ្តី';
    const body = syllable.repeat(MAX_NOTE_LENGTH + 1);
    expect(validateNote({ title: null, body })).toBe('body_too_long');
    expect(validateNote({ title: null, body: syllable.repeat(10) })).toBeNull();
  });

  it('caps a set title', () => {
    expect(validateNote({ title: 'a'.repeat(MAX_NOTE_TITLE_LENGTH + 1), body: 'x' })).toBe(
      'title_too_long',
    );
  });
});

describe('normalizeNoteTitle', () => {
  it('treats empty and absent as the same fact', () => {
    expect(normalizeNoteTitle('   ')).toBeNull();
    expect(normalizeNoteTitle(null)).toBeNull();
  });

  it('collapses whitespace and composes to NFC', () => {
    expect(normalizeNoteTitle('  two   words ')).toBe('two words');
  });
});

describe('noteTitle', () => {
  it('derives the first line when no title is set', () => {
    expect(noteTitle({ title: null, body: 'call the supplier\nthey close at 5' })).toBe(
      'call the supplier',
    );
  });

  it('reads the first line as Markdown rather than stripping characters', () => {
    expect(noteTitle({ title: null, body: '# Standup\n\nnotes' })).toBe('Standup');
    expect(noteTitle({ title: null, body: '- `git rebase` first' })).toBe('git rebase first');
  });

  it('prefers a set title', () => {
    expect(noteTitle({ title: 'Suppliers', body: 'call the supplier' })).toBe('Suppliers');
  });

  it('truncates by grapheme with an ellipsis', () => {
    const title = noteTitle({ title: null, body: 'ស'.repeat(200) });
    expect(title.endsWith('…')).toBe(true);
    expect([...title].length).toBeLessThan(200);
  });

  it('is empty for a body with nothing in it, rather than throwing', () => {
    expect(noteTitle({ title: null, body: '' })).toBe('');
  });
});

describe('notePreview', () => {
  it('is what is left after the first line became the title', () => {
    expect(notePreview({ title: null, body: 'call the supplier\nthey close at 5' })).toBe(
      'they close at 5',
    );
  });

  it('is the whole body when a title was set', () => {
    expect(notePreview({ title: 'Suppliers', body: 'call them back' })).toBe('call them back');
  });

  it('is empty for a one-line note, which most notes are', () => {
    expect(notePreview({ title: null, body: 'call the supplier' })).toBe('');
  });
});
