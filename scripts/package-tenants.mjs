// Package the migrated tenants as one-drop ZIP archives (FR-6.7 intake):
// each ZIP carries exactly what the drop zone asks for — registry.json,
// <tenant>.env.json, the tenant snapshot(s) and the shared pseudo pools.
// Idempotent: reads scripts/migrate-legacy.config.json for the tenant list,
// rebuilds data/migration/<tenant>.tenant.zip from the current files, and
// self-verifies every archive with the APP's own ZIP reader + classifier.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { readZipEntries } from '../src/sections/05-dropzone.js';
import { classifyFile } from '../src/sections/04-storage.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDir = join(repoRoot, 'data/migration');

// --- minimal ZIP writer (deflate/store, CRC32, central directory) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(files /* [{ name, data: Buffer }] */) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const data = f.data;
    const deflated = deflateRawSync(data);
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(data);
    const name = Buffer.from(f.name, 'utf8');
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);          // version needed
    lfh.writeUInt16LE(0x0800, 6);      // UTF-8 names
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(name.length, 26);
    parts.push(lfh, name, payload);
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0x0800, 8);
    cdh.writeUInt16LE(method, 10);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(payload.length, 20);
    cdh.writeUInt32LE(data.length, 24);
    cdh.writeUInt16LE(name.length, 28);
    cdh.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cdh, name]));
    offset += 30 + name.length + payload.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eocd]);
}

// --- packaging --------------------------------------------------------------
async function verifyWithAppReader(zipBuffer, expectedKinds) {
  const fileLike = { name: 'tenant.zip', arrayBuffer: async () => zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength) };
  const entries = await readZipEntries(fileLike);
  const kinds = [];
  for (const en of entries) kinds.push((await classifyFile(en.file)).kind);
  kinds.sort();
  const expected = [...expectedKinds].sort();
  if (JSON.stringify(kinds) !== JSON.stringify(expected)) {
    throw new Error(`self-check failed: classified as [${kinds}] instead of [${expected}]`);
  }
  return entries.length;
}

async function main() {
  if (!existsSync(migrationDir)) {
    console.log('no data/migration output — run scripts/migrate-legacy.mjs first');
    return;
  }
  const cfg = JSON.parse(readFileSync(join(repoRoot, 'scripts/migrate-legacy.config.json'), 'utf8'));
  const registry = readFileSync(join(repoRoot, 'schema/registry.json'));
  const pseudoPath = join(repoRoot, 'data/pseudo.data.json');
  const pseudo = existsSync(pseudoPath) ? readFileSync(pseudoPath) : null;

  for (const tenant of Object.keys(cfg.tenants)) {
    const envPath = join(migrationDir, `${tenant}.env.json`);
    const snaps = readdirSync(migrationDir).filter((f) => f.startsWith(`${tenant}.snapshot-`) && f.endsWith('.json'));
    if (!existsSync(envPath) || !snaps.length) {
      console.log(`${tenant}: skipped (no migrated env/snapshot — run scripts/migrate-legacy.mjs)`);
      continue;
    }
    const files = [
      { name: 'registry.json', data: registry },
      { name: `${tenant}.env.json`, data: readFileSync(envPath) },
      ...snaps.map((s) => ({ name: s, data: readFileSync(join(migrationDir, s)) })),
    ];
    const expectedKinds = ['registry', 'env', ...snaps.map(() => 'snapshot')];
    if (pseudo) { files.push({ name: 'pseudo.data.json', data: pseudo }); expectedKinds.push('pseudo'); }
    const zip = buildZip(files);
    const entryCount = await verifyWithAppReader(zip, expectedKinds);
    const out = join(migrationDir, `${tenant}.tenant.zip`);
    writeFileSync(out, zip);
    console.log(`${tenant}: ${out} (${(zip.length / 1e6).toFixed(1)} MB, ${entryCount} Dateien, App-Reader-Selbsttest OK)`);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1]);
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith('package-tenants.mjs') && process.argv[1].endsWith('package-tenants.mjs')) {
  await main();
}
