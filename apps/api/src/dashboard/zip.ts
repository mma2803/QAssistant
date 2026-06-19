import { crc32 } from 'node:zlib';

/**
 * Minimal store-mode (uncompressed) ZIP archive builder with no external
 * dependency. Produces a spec-valid ZIP (local file headers + central directory
 * + end-of-central-directory) so the dashboard export endpoint can stream a
 * single archive without pulling in archiver/jszip. Files are stored, not
 * deflated: artifacts are already small or pre-compressed (dom_chunk is gzip),
 * and store mode keeps the implementation dependency-free and correct.
 *
 * Limitations (acceptable for MVP export): no ZIP64, so total size and per-file
 * size must fit in 32 bits (4 GiB); session exports are far below that.
 */
interface Entry {
  name: string;
  data: Buffer;
  crc: number;
  offset: number;
}

export class ZipBuilder {
  private readonly chunks: Buffer[] = [];
  private readonly entries: Entry[] = [];
  private offset = 0;

  /** Add a file. `name` uses forward slashes for directories. */
  addFile(name: string, data: Buffer | string): void {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const crc = crc32(buf) >>> 0;
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18); // compressed size
    local.writeUInt32LE(buf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    this.entries.push({ name, data: buf, crc, offset: this.offset });
    this.push(local);
    this.push(nameBuf);
    this.push(buf);
  }

  /** Finalize and return the complete ZIP buffer. */
  build(): Buffer {
    const cdStart = this.offset;
    const central: Buffer[] = [];
    for (const e of this.entries) {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const head = Buffer.alloc(46);
      head.writeUInt32LE(0x02014b50, 0); // central dir signature
      head.writeUInt16LE(20, 4); // version made by
      head.writeUInt16LE(20, 6); // version needed
      head.writeUInt16LE(0, 8); // flags
      head.writeUInt16LE(0, 10); // method
      head.writeUInt16LE(0, 12); // mod time
      head.writeUInt16LE(0, 14); // mod date
      head.writeUInt32LE(e.crc, 16);
      head.writeUInt32LE(e.data.length, 20);
      head.writeUInt32LE(e.data.length, 24);
      head.writeUInt16LE(nameBuf.length, 28);
      head.writeUInt16LE(0, 30); // extra length
      head.writeUInt16LE(0, 32); // comment length
      head.writeUInt16LE(0, 34); // disk number
      head.writeUInt16LE(0, 36); // internal attrs
      head.writeUInt32LE(0, 38); // external attrs
      head.writeUInt32LE(e.offset, 42); // local header offset
      central.push(head, nameBuf);
    }
    const cd = Buffer.concat(central);

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // end of central dir signature
    eocd.writeUInt16LE(0, 4); // disk number
    eocd.writeUInt16LE(0, 6); // cd start disk
    eocd.writeUInt16LE(this.entries.length, 8); // entries on disk
    eocd.writeUInt16LE(this.entries.length, 10); // total entries
    eocd.writeUInt32LE(cd.length, 12); // cd size
    eocd.writeUInt32LE(cdStart, 16); // cd offset
    eocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([...this.chunks, cd, eocd]);
  }

  private push(buf: Buffer): void {
    this.chunks.push(buf);
    this.offset += buf.length;
  }
}
