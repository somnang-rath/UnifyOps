import { describe, expect, it } from 'vitest';
import { parseRecipients } from './recipients';

/**
 * §7.10's bulk invite, in the form it actually arrives in.
 *
 * Every case here is a real paste: a column out of a spreadsheet, a row copied
 * from a mail client, a CSV exported by an HR system, someone typing addresses
 * separated by whatever was under their thumb. The plan's rule is that a bad
 * entry is flagged in place and the rest still send, so nothing below expects a
 * throw and nothing expects the batch to be rejected.
 */

describe('parseRecipients', () => {
  it('splits on commas, spaces, semicolons and new lines alike', () => {
    const { recipients, invalid } = parseRecipients(
      'a@acme.com, b@acme.com\nc@acme.com;d@acme.com e@acme.com',
    );

    expect(recipients.map((r) => r.email)).toEqual([
      'a@acme.com',
      'b@acme.com',
      'c@acme.com',
      'd@acme.com',
      'e@acme.com',
    ]);
    expect(invalid).toEqual([]);
  });

  it('unwraps the display-name form mail clients produce', () => {
    // The single most common paste in the product. Treating it as malformed
    // would fail the everyday case.
    const { recipients } = parseRecipients('Sophea Chan <sophea@acme.com>');
    expect(recipients.map((r) => r.email)).toEqual(['sophea@acme.com']);
  });

  it('collapses duplicates rather than rejecting them, case-insensitively', () => {
    const { recipients, duplicates } = parseRecipients('A@acme.com\na@ACME.com\na@acme.com');
    expect(recipients.map((r) => r.email)).toEqual(['a@acme.com']);
    expect(duplicates).toBe(2);
  });

  it('flags what it cannot read and keeps the rest', () => {
    const { recipients, invalid } = parseRecipients('good@acme.com, not-an-email, also@acme.com');
    expect(recipients.map((r) => r.email)).toEqual(['good@acme.com', 'also@acme.com']);
    expect(invalid).toEqual(['not-an-email']);
  });

  it('reads a CSV with role and team columns', () => {
    const { recipients } = parseRecipients(
      ['email,role,team', 'sophea@acme.com,admin,Engineering', 'dara@acme.com,member,Design'].join(
        '\n',
      ),
    );

    expect(recipients).toEqual([
      { email: 'sophea@acme.com', role: 'admin', team: 'Engineering' },
      { email: 'dara@acme.com', role: 'member', team: 'Design' },
    ]);
  });

  it('reads a CSV with no header row', () => {
    // Plenty of real exports have none, so header detection cannot be what
    // decides whether a line is a CSV record.
    const { recipients } = parseRecipients('sophea@acme.com,guest,Design');
    expect(recipients).toEqual([{ email: 'sophea@acme.com', role: 'guest', team: 'Design' }]);
  });

  it('tells a CSV record apart from a run-on list on the same line', () => {
    // The distinguishing question is what follows the first comma: another
    // address means a list, anything else means columns.
    const list = parseRecipients('a@acme.com,b@acme.com');
    expect(list.recipients.map((r) => r.email)).toEqual(['a@acme.com', 'b@acme.com']);
    expect(list.recipients.every((r) => r.role === undefined)).toBe(true);
  });

  it('ignores an unrecognised role rather than failing the row', () => {
    const { recipients } = parseRecipients('sophea@acme.com,supervisor,Design');
    expect(recipients).toEqual([{ email: 'sophea@acme.com', team: 'Design' }]);
  });

  it('handles quoted CSV fields', () => {
    const { recipients } = parseRecipients('"sophea@acme.com","member","Design, West"');
    expect(recipients[0]?.email).toBe('sophea@acme.com');
    expect(recipients[0]?.role).toBe('member');
  });

  it('is empty for empty input, and does not throw', () => {
    expect(parseRecipients('')).toEqual({ recipients: [], invalid: [], duplicates: 0 });
    expect(parseRecipients('   \n\n  ')).toEqual({ recipients: [], invalid: [], duplicates: 0 });
  });

  it('handles a forty-address paste, which is the case it exists for', () => {
    // §2.1's 40-person company. The point of the feature is that this is one
    // action rather than forty.
    const raw = Array.from({ length: 40 }, (_, i) => `person${i}@acme.com`).join('\n');
    const { recipients, invalid } = parseRecipients(raw);
    expect(recipients).toHaveLength(40);
    expect(invalid).toEqual([]);
  });
});
