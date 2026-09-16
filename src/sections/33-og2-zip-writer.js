// OrgGraph 2.0 — in-app ZIP writer (E77): the counterpart of the drop zone's
// reader (05). Entries are deflated with the platform's CompressionStream
// ('deflate-raw'); the result is a plain ZIP with a central directory that
// readZipEntries, package-tenants and every archiver understand.
const ZIP_TEXT = new TextEncoder();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  // a hand-made ReadableStream (Blob.stream() is missing in jsdom)
  const source = new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  const reader = source.pipeThrough(new CompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// DOS date/time fields of a Date (ZIP has no better clock)
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const toBytes = (data) => (typeof data === 'string' ? ZIP_TEXT.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data));

// entries: [{ name, data: string | Uint8Array | ArrayBuffer }] → Uint8Array (ZIP bytes)
export async function buildZip(entries, { now = new Date() } = {}) {
  const { time, date } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const entry of entries) {
    const name = ZIP_TEXT.encode(entry.name);
    const raw = toBytes(entry.data);
    const crc = crc32(raw);
    const packed = raw.length ? await deflateRaw(raw) : raw;
    const stored = packed.length >= raw.length;   // incompressible: store as-is
    const body = stored ? raw : packed;
    const method = stored ? 0 : 8;
    const flags = 0x0800;                            // UTF-8 names
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(body.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...name,
    ]);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(time), ...u16(date),
      ...u32(crc), ...u32(body.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ]));
    chunks.push(local, body);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);
  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of [...chunks, ...central, eocd]) { out.set(c, pos); pos += c.length; }
  return out;
}
