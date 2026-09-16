// OrgGraph 2.0 — tenant export and restore (E77). One ZIP carries the whole
// tenant: registry, env (views), the store in its chunked persistence layout
// (header + parts, exactly what the profile holds — no re-encoding) and a
// plain manifest. Dropping such a ZIP restores the tenant 1:1; the hub (tools/
// hub.py) keeps the same ZIP age-encrypted in the tenant's git repo.
import { KEY_STORE, KEY_STORE_PART_PREFIX, KEY_REGISTRY, KEY_ENV, getStoredText, putStored, delStored, listProfiles, getActiveProfileId } from './04-storage.js';
import { serializeTenantStoreParts, isChunkedStoreHeader } from './29-og2-app.js';
import { og2State } from './30-og2-ui.js';
import { buildZip } from './33-og2-zip-writer.js';

export const TENANT_FORMAT = 'orggraph-tenant-2';
const MANIFEST = 'manifest.json';
const STORE_HEADER = 'store.json';
const storePartName = (i) => `store.part${i}.json`;

const rfc3339Now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function og2TenantName() {
  const id = await getActiveProfileId();
  const p = (await listProfiles()).find((x) => x.id === id);
  return (p && p.name) || id || 'tenant';
}

// What the export says about itself (plain in the ZIP and in the hub repo).
export function og2TenantManifest(state, { tenant, exportedAt = rfc3339Now(), parts = 0 } = {}) {
  const store = state && state.store;
  return {
    format: TENANT_FORMAT,
    exportedAt,
    tenant,
    appVersion: typeof APP_VERSION === 'string' ? APP_VERSION : null,
    registryVersion: state && state.registry ? state.registry.version || null : null,
    counts: store ? { nodes: store.nodes.size, edges: store.edges.size, snapshots: store.snapshots.size } : null,
    sources: store && store.sourceBook ? [...store.sourceBook.keys()].sort() : [],
    lastSnapshot: store ? [...store.snapshots.values()].map((s) => s.stamp).filter(Boolean).sort().pop() || null : null,
    storeParts: parts,
    views: state && state.env && state.env.VIEWS ? Object.keys(state.env.VIEWS) : [],
  };
}

// Build the tenant ZIP of the running tenant: { name, bytes, manifest }.
export async function og2BuildTenantZip() {
  const state = og2State();
  if (!state || !state.store || !state.registry) throw new Error('kein geladener Mandant');
  const tenant = await og2TenantName();
  const { header, parts } = serializeTenantStoreParts(state.store);
  const manifest = og2TenantManifest(state, { tenant, parts: parts.length });
  const entries = [
    { name: MANIFEST, data: JSON.stringify(manifest, null, 2) },
    { name: 'registry.json', data: JSON.stringify(state.registry, null, 2) },
    { name: 'env.json', data: JSON.stringify(state.env || {}, null, 2) },
    { name: STORE_HEADER, data: header },
    ...parts.map((p, i) => ({ name: storePartName(i), data: p })),
  ];
  const bytes = await buildZip(entries);
  const stamp = manifest.exportedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return { name: `tenant-${tenant}-${stamp}.zip`, bytes, manifest };
}

// Dropped entries [{ path, file }] (already ZIP-expanded): is this a tenant export?
export async function og2TenantManifestOf(entries) {
  const hit = (entries || []).find((e) => /(^|\/)manifest\.json$/i.test(e.path || ''));
  if (!hit || !hit.file) return null;
  try {
    const m = JSON.parse(await hit.file.text());
    return m && m.format === TENANT_FORMAT ? m : null;
  } catch { return null; }
}

// Restore a tenant export into the ACTIVE profile: registry, env, store parts.
// Caller reloads afterwards. Returns the manifest.
export async function og2RestoreTenant(entries) {
  const byName = new Map((entries || []).map((e) => [String(e.path || '').split('/').pop(), e.file]));
  const text = async (name) => { const f = byName.get(name); return f ? f.text() : null; };
  const manifestText = await text(MANIFEST);
  const manifest = manifestText ? JSON.parse(manifestText) : null;
  if (!manifest || manifest.format !== TENANT_FORMAT) throw new Error('kein Tenant-Export (manifest.json fehlt)');
  const registry = await text('registry.json');
  const env = await text('env.json');
  const header = await text(STORE_HEADER);
  if (!registry || !header || !isChunkedStoreHeader(header)) throw new Error('Tenant-Export unvollständig (registry.json / store.json)');
  const partCount = JSON.parse(header).parts;
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const p = await text(storePartName(i));
    if (p == null) throw new Error(`Tenant-Export unvollständig: ${storePartName(i)} fehlt`);
    parts.push(p);
  }
  const prev = await getStoredText(KEY_STORE);
  const prevParts = prev != null && isChunkedStoreHeader(prev) ? JSON.parse(prev).parts : 0;
  await putStored(KEY_REGISTRY, registry);
  if (env) await putStored(KEY_ENV, env);
  for (let i = 0; i < parts.length; i++) await putStored(KEY_STORE_PART_PREFIX + i, parts[i]);
  await putStored(KEY_STORE, header);
  for (let i = parts.length; i < prevParts; i++) await delStored(KEY_STORE_PART_PREFIX + i);
  return manifest;
}

/* v8 ignore start */
export async function og2DownloadTenantZip() {
  const { name, bytes, manifest } = await og2BuildTenantZip();
  const blob = new Blob([bytes], { type: 'application/zip' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  showTemporaryNotification(`Mandant exportiert: ${name} (${manifest.counts.nodes} Knoten, ${manifest.counts.edges} Kanten)`);
  return name;
}
/* v8 ignore stop */
