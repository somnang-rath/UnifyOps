import { deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * A zip writer and a zip reader, with no dependency (§21.8 — slice 22).
 *
 * **This is the same bargain `sigv4.ts` makes against `@aws-sdk`, the burndown
 * makes against a charting library and `dialog.tsx` makes against Radix**, and
 * it is an easier one than any of them: the archive this product writes is a few
 * dozen small text files, and the format that holds them was frozen in 1993. A
 * zip is a run of file records, a directory saying where each one starts, and
 * twenty-two bytes at the end saying where that directory is. `node:zlib`
 * already ships the only hard part.
 *
 * The argument specific to *this* feature is §21.8's own: "a product that is
 * easy to leave is easier to adopt". An export is the promise the pilot customer
 * (§18-7) will actually test, so it must not be the one part of the product that
 * breaks because a transitive dependency changed a default — which is precisely
 * the failure §20.7 named when it refused a Markdown library for its HTML
 * passthrough.
 *
 * **What is deliberately not implemented, and what happens instead.** Zip64
 * (archives over 4 GiB or 65,535 entries), encryption and multi-disk archives
 * are refused by `readZip` with a named reason rather than mis-parsed, because a
 * reader that silently returns half an archive is worse than one that says it
 * cannot read this at all. `writeZip` cannot produce any of them: what it serves
 * is bounded two orders of magnitude below the first of those limits.
 *
 * In `src/server` rather than `src/lib` because `node:zlib` is a Node builtin
 * and no client asks for one — and with no `import 'server-only'`, for the
 * reason `sigv4.ts` has none: it touches no connection, so it is ordinary
 * unit-testable code that happens to run on the server.
 */

/** One file going in, or one coming out. */
export type ZipEntry = {
  /** A forward-slashed path relative to the archive root. Never absolute. */
  path: string;
  bytes: Uint8Array;
};

export type ZipFailure = 'not_a_zip' | 'unsupported' | 'corrupt';

export class ZipError extends Error {
  constructor(readonly reason: ZipFailure) {
    super(`zip: ${reason}`);
    this.name = 'ZipError';
  }
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

/**
 * Bit 11 — "the name in this record is UTF-8".
 *
 * **Not optional here, and §13 is why.** Without it a reader is entitled to
 * decode the filename as CP437, and a Khmer page title becomes a row of accented
 * Latin letters at the moment somebody unzips the export they asked for to prove
 * their data is theirs. §21.14's check 4 is exactly that: "export a Khmer space
 * and open the files in a plain text editor".
 */
const FLAG_UTF8 = 0x0800;

/** Bit 3 — sizes follow the data rather than preceding it. Read, never written. */
const FLAG_DATA_DESCRIPTOR = 0x0008;

/** Bit 0 — encrypted. Refused. */
const FLAG_ENCRYPTED = 0x0001;

/* ------------------------------------------------------------------------- */
/* CRC-32                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Built once, lazily. Most requests in this product never touch an archive, and
 * a kilobyte of module state allocated at import is a kilobyte in every worker.
 */
let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const next = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    next[index] = value >>> 0;
  }
  crcTable = next;
  return next;
}

export function crc32(bytes: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (lookup[(crc ^ (bytes[index] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------------- */
/* Writing                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * MS-DOS date and time — two 16-bit fields, two-second resolution, a 1980 epoch.
 *
 * A fixed timestamp would have been simpler and is refused: a folder of files
 * all dated 1980 reads as corrupt to the person looking at it, and "last edited"
 * is one of the four facts §21.8 asks the export to carry. The authoritative
 * copy of that fact is the front matter, which carries a real ISO timestamp;
 * this is the filesystem's rounding of it.
 *
 * Clamped at 1980 rather than refused, because a clamp cannot fail an export
 * over a clock.
 */
function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.max(1980, when.getUTCFullYear());
  return {
    date:
      (((year - 1980) & 0x7f) << 9) |
      (((when.getUTCMonth() + 1) & 0x0f) << 5) |
      (when.getUTCDate() & 0x1f),
    time:
      ((when.getUTCHours() & 0x1f) << 11) |
      ((when.getUTCMinutes() & 0x3f) << 5) |
      ((when.getUTCSeconds() >> 1) & 0x1f),
  };
}

/**
 * Build an archive.
 *
 * Entries are written in the order given, which is the order somebody reading
 * the folder will meet them — so the caller sorts, not this.
 *
 * **Stored rather than deflated whenever deflate does not help**, which is a
 * correctness habit rather than an optimisation: a very small file *grows* under
 * deflate, and an archive whose parts are bigger than their contents is the kind
 * of thing that gets mistrusted long before it gets measured.
 */
export function writeZip(entries: readonly ZipEntry[], when: Date = new Date()): Uint8Array {
  const { date, time } = dosDateTime(when);

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = Buffer.from(entry.bytes);
    const deflated = deflateRawSync(raw);

    const useDeflate = deflated.length < raw.length;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const payload = useDeflate ? deflated : raw;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    /*
      "Made by" version 20 on filesystem 0 (MS-DOS/FAT), which is what every
      cross-platform writer claims — it is the one value that carries no
      platform permission bits for a reader to try to honour, so an unzipped
      export inherits the reader's own umask rather than something this process
      guessed.
    */
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(EOCD_SIG, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/* ------------------------------------------------------------------------- */
/* Reading                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Where the end-of-central-directory record starts.
 *
 * Scanned backwards, because the record is last and its only fixed property is
 * its signature. An archive may carry a trailing comment of up to 64 KiB, which
 * is what bounds the search. A *forward* scan would also find those four bytes
 * inside a stored file that happened to contain them — which a text export
 * easily could, since this module's own source names the constant.
 */
function findEndRecord(bytes: Buffer): number {
  const floor = Math.max(0, bytes.length - (22 + 0xffff));
  for (let index = bytes.length - 22; index >= floor; index -= 1) {
    if (bytes.readUInt32LE(index) === EOCD_SIG) return index;
  }
  return -1;
}

/**
 * Read an archive, returning its files in central-directory order.
 *
 * **Sizes and the compression method come from the central directory, never from
 * the local header**, and that is the one decision here a first attempt gets
 * wrong. A writer that streams — which is most of them, including every browser
 * and `zip -` — sets bit 3 and writes zeroes for the sizes in the local header,
 * putting the real ones in a descriptor *after* the data. The central directory
 * is always complete, so reading from it handles both shapes with no branch. The
 * local header is still parsed for exactly one number: how long its name and
 * extra fields are, which is where the data begins.
 *
 * Directory entries — a path ending in `/`, which is how a zip records an empty
 * folder — are dropped. The importer derives its tree from the file paths, so a
 * folder marker carries nothing, and returning zero-byte "files" would make
 * every caller filter them out again.
 */
export function readZip(input: Uint8Array): ZipEntry[] {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < 22) throw new ZipError('not_a_zip');

  const end = findEndRecord(bytes);
  if (end < 0) throw new ZipError('not_a_zip');

  const total = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16);

  /*
    0xffff entries, or a 0xffffffff size or offset, is the sentinel meaning "the
    real value is in the Zip64 record" — which this reader does not implement.
    Saying so is the whole handling: half an archive silently returned is the
    failure this refusal exists to prevent.
  */
  if (total === 0xffff || cursor === 0xffffffff || directorySize === 0xffffffff) {
    throw new ZipError('unsupported');
  }
  if (cursor + directorySize > bytes.length) throw new ZipError('corrupt');

  const entries: ZipEntry[] = [];

  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > bytes.length) throw new ZipError('corrupt');
    if (bytes.readUInt32LE(cursor) !== CENTRAL_SIG) throw new ZipError('corrupt');

    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const checksum = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);

    if ((flags & FLAG_ENCRYPTED) !== 0) throw new ZipError('unsupported');
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) throw new ZipError('unsupported');

    const path = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    // How a zip records an empty folder. There is nothing in it to hand back.
    if (path.endsWith('/')) continue;

    /*
      Bit 3 with a zero compressed size in the *central* directory is a writer
      that never went back to fill it in — the one shape where the rule above
      does not save us, and the one that would otherwise be read as an empty
      file rather than as a broken archive.
    */
    if ((flags & FLAG_DATA_DESCRIPTOR) !== 0 && compressedSize === 0 && uncompressedSize > 0) {
      throw new ZipError('corrupt');
    }

    if (localOffset + 30 > bytes.length) throw new ZipError('corrupt');
    if (bytes.readUInt32LE(localOffset) !== LOCAL_SIG) throw new ZipError('corrupt');

    const start =
      localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    if (start + compressedSize > bytes.length) throw new ZipError('corrupt');

    const payload = bytes.subarray(start, start + compressedSize);

    let data: Buffer;
    if (method === METHOD_STORE) {
      data = Buffer.from(payload);
    } else {
      try {
        data = inflateRawSync(payload);
      } catch {
        throw new ZipError('corrupt');
      }
    }

    /*
      The checksum is the only thing that catches a file which decompressed to
      *something* rather than to what was archived, and an importer that writes a
      company's documentation is the wrong place to save two microseconds by
      skipping it.
    */
    if (data.length !== uncompressedSize || crc32(data) !== checksum) {
      throw new ZipError('corrupt');
    }

    entries.push({ path, bytes: new Uint8Array(data) });
  }

  return entries;
}
