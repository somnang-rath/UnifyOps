import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { crc32, readZip, writeZip, ZipError } from './zip';

/**
 * The zip writer and reader (§21.8 — slice 22).
 *
 * **The round trip is the cheap half of this suite and the weak half.** A writer
 * and a reader written by the same person on the same afternoon agree with each
 * other whether or not either agrees with the format — which is exactly the
 * failure `sigv4.test.ts` was written to avoid, and it solved it by asserting
 * against AWS's own published worked example rather than against itself.
 *
 * There is no equivalent published archive to check byte-for-byte, so the
 * substitute is to assert the parts of the *format* independently of this
 * module's own writer: the signatures and offsets at the byte level, a CRC-32
 * against the value the standard is defined to produce, and an archive
 * assembled by hand from `node:zlib` rather than by `writeZip`. The day the
 * reader and the writer drift together, those are the tests that fail.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function entry(path: string, text: string) {
  return { path, bytes: encoder.encode(text) };
}

describe('crc32', () => {
  /**
   * The check value every CRC-32 implementation is defined by — `"123456789"`
   * is the standard's own test vector, and `0xcbf43926` is the answer. Asserting
   * this rather than "the writer agrees with the reader" is what makes the
   * checksum a real check: a table built with the polynomial written backwards
   * is self-consistent and wrong.
   */
  it('produces the standard check value', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
  });

  it('is zero for no bytes', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('writeZip', () => {
  it('writes the three signatures the format is made of', () => {
    const bytes = Buffer.from(writeZip([entry('a.md', 'hello')]));

    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    // The end record is last and fixed-length when there is no comment.
    const end = bytes.length - 22;
    expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
    expect(bytes.readUInt16LE(end + 10)).toBe(1);

    const directory = bytes.readUInt32LE(end + 16);
    expect(bytes.readUInt32LE(directory)).toBe(0x02014b50);
  });

  /**
   * §13, and the reason the flag is not optional. Without bit 11 a reader is
   * entitled to decode the name as CP437, and §21.14's check 4 is somebody
   * opening a Khmer export in a plain text editor.
   */
  it('marks filenames as UTF-8', () => {
    const bytes = Buffer.from(writeZip([entry('a.md', 'x')]));
    expect(bytes.readUInt16LE(6) & 0x0800).toBe(0x0800);
  });

  it('stores rather than deflates when deflate would not help', () => {
    // One byte cannot compress; deflate adds framing, so STORE has to win.
    const bytes = Buffer.from(writeZip([entry('a.md', 'x')]));
    expect(bytes.readUInt16LE(8)).toBe(0);
  });

  it('deflates when it helps', () => {
    const bytes = Buffer.from(writeZip([entry('a.md', 'ha'.repeat(2_000))]));
    expect(bytes.readUInt16LE(8)).toBe(8);
    expect(bytes.length).toBeLessThan(1_000);
  });

  it('writes an empty archive', () => {
    const bytes = writeZip([]);
    expect(bytes.length).toBe(22);
    expect(readZip(bytes)).toEqual([]);
  });
});

describe('readZip', () => {
  it('round-trips paths, order and content', () => {
    const files = [
      entry('handbook.md', '# Handbook\n'),
      entry('handbook/onboarding.md', '# Onboarding\n'),
      entry('handbook/onboarding/day-one.md', 'x'.repeat(5_000)),
    ];

    const back = readZip(writeZip(files));

    expect(back.map((file) => file.path)).toEqual([
      'handbook.md',
      'handbook/onboarding.md',
      'handbook/onboarding/day-one.md',
    ]);
    expect(decoder.decode(back[2]?.bytes)).toBe('x'.repeat(5_000));
  });

  /**
   * §13 again, from the other side. A Khmer filename and a Khmer body have to
   * survive the trip as themselves — this is §21.14's check 4 reduced to the one
   * property a test can hold.
   */
  it('round-trips Khmer in both the name and the body', () => {
    const back = readZip(writeZip([entry('ព័ត៌មាន.md', 'សួស្តី​ពិភពលោក')]));

    expect(back[0]?.path).toBe('ព័ត៌មាន.md');
    expect(decoder.decode(back[0]?.bytes)).toBe('សួស្តី​ពិភពលោក');
  });

  it('drops folder markers', () => {
    const back = readZip(writeZip([{ path: 'handbook/', bytes: new Uint8Array(0) }, entry('a.md', 'x')]));
    expect(back.map((file) => file.path)).toEqual(['a.md']);
  });

  /**
   * The reader must not be checking only its own writer's output. This archive
   * is assembled here, by hand, from `node:zlib` — and it uses the shape most
   * real writers produce and `writeZip` never does: a **data descriptor**, where
   * the local header carries zeroes and the true sizes live in the central
   * directory. A reader that trusted the local header returns an empty file.
   */
  it('reads an archive whose local header has no sizes', () => {
    const name = Buffer.from('streamed.md', 'utf8');
    const raw = Buffer.from('written by something else\n', 'utf8');
    const payload = deflateRawSync(raw);
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800 | 0x0008, 6);
    local.writeUInt16LE(8, 8);
    // Zeroes, which is what bit 3 means: "the sizes come after the data".
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(0, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(name.length, 26);

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(sum, 4);
    descriptor.writeUInt32LE(payload.length, 8);
    descriptor.writeUInt32LE(raw.length, 12);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800 | 0x0008, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);

    const localPart = Buffer.concat([local, name, payload, descriptor]);
    const directory = Buffer.concat([central, name]);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(localPart.length, 16);

    const back = readZip(Buffer.concat([localPart, directory, end]));
    expect(decoder.decode(back[0]?.bytes)).toBe('written by something else\n');
  });

  it('refuses something that is not an archive', () => {
    expect(() => readZip(encoder.encode('this is a text file, not a zip at all')))
      .toThrow(ZipError);
  });

  it('refuses an archive whose bytes were altered', () => {
    const bytes = Buffer.from(writeZip([entry('a.md', 'the original sentence')]));
    // Flip a byte inside the stored payload. The sizes and the offsets still
    // agree, so only the checksum can catch it — which is the whole reason the
    // reader spends the microseconds on one.
    const start = 30 + Buffer.from('a.md').length;
    bytes[start] = (bytes[start] as number) ^ 0xff;

    expect(() => readZip(bytes)).toThrow(ZipError);
  });

  it('refuses an encrypted entry rather than returning its ciphertext', () => {
    const bytes = Buffer.from(writeZip([entry('a.md', 'x')]));
    const end = bytes.length - 22;
    const directory = bytes.readUInt32LE(end + 16);
    bytes.writeUInt16LE(bytes.readUInt16LE(directory + 8) | 0x0001, directory + 8);

    expect(() => readZip(bytes)).toThrow(ZipError);
  });

  /**
   * The end record is found by scanning backwards, so a stored file containing
   * those four bytes must not be mistaken for it. A text export easily could —
   * `zip.ts`'s own source names the constant.
   */
  it('is not confused by a file containing the end signature', () => {
    const decoy = Buffer.alloc(64);
    decoy.writeUInt32LE(0x06054b50, 8);

    const back = readZip(writeZip([{ path: 'decoy.bin', bytes: new Uint8Array(decoy) }]));
    expect(back).toHaveLength(1);
    expect(Buffer.from(back[0]?.bytes as Uint8Array)).toEqual(decoy);
  });
});
