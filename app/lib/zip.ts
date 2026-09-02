// Built by Kiril Ivlev · https://www.linkedin.com/in/kiril-ivlev/
// QC Portal — proprietary. Not licensed for redistribution or resale.

/**
 * A tiny ZIP writer, so the Brain tab can hand a client their whole folder as one download.
 *
 * ── Why not a library ───────────────────────────────────────────────────────────────────────────
 * The archive is a few dozen small markdown files. Pulling `archiver` or `jszip` into the bundle for
 * that is a dependency to keep patched for the sake of two hundred lines it does not save — the ZIP
 * format's stored-and-deflated path is small enough to write directly, and writing it directly means
 * there is nothing here that can drift out of support.
 *
 * ── What it produces ────────────────────────────────────────────────────────────────────────────
 * A standard single-disk ZIP: a local header + DEFLATE-compressed data per file, then a central
 * directory, then the end record. No Zip64, so the whole archive must stay under 4GB — which a folder
 * of markdown always is. Every entry carries the UTF-8 name flag so non-ASCII file names survive.
 */
import { deflateRawSync } from "zlib";

/** CRC-32, the checksum every ZIP entry is required to carry. Table-free; the archives here are small. */
function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let index = 0; index < buf.length; index += 1) {
    crc ^= buf[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

export type ZipEntry = { name: string; data: Buffer };

/** One fixed DOS timestamp for every entry — the files carry their real dates in the brain, not here. */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01, the ZIP epoch.

export function buildZip(entries: ZipEntry[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const compressed = deflateRawSync(entry.data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // flags: UTF-8 name
    header.writeUInt16LE(8, 8); // method: deflate
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28); // extra length
    local.push(header, name, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); // central directory signature
    record.writeUInt16LE(20, 4); // version made by
    record.writeUInt16LE(20, 6); // version needed
    record.writeUInt16LE(0x0800, 8); // flags: UTF-8 name
    record.writeUInt16LE(8, 10); // method: deflate
    record.writeUInt16LE(DOS_TIME, 12);
    record.writeUInt16LE(DOS_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(0, 30); // extra length
    record.writeUInt16LE(0, 32); // comment length
    record.writeUInt16LE(0, 34); // disk number
    record.writeUInt16LE(0, 36); // internal attributes
    record.writeUInt32LE(0, 38); // external attributes
    record.writeUInt32LE(offset, 42); // offset of local header
    central.push(record, name);

    offset += header.length + name.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralBuf.length, 12); // central directory size
  end.writeUInt32LE(offset, 16); // central directory offset
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...local, centralBuf, end]);
}
