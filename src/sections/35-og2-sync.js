// OrgGraph 2.0 — hub sync (E77): when the app is served by tools/hub.py under
// /t/<tenant>/, the tenant's git repo is the durable truth. Every load pulls
// (the hub pulls, the app compares the manifest with what it last synced and
// restores a newer export before booting); every change pushes (the app
// builds the tenant ZIP, the hub encrypts, commits and pushes). Under file://
// nothing here runs — the offline single file stays as it is.
import { KEY_SYNC, getStoredJson, putStored, listProfiles, createProfile, switchProfile, getActiveProfileId } from './04-storage.js';
import { readZipEntries } from './05-dropzone.js';
import { og2BuildTenantZip, og2RestoreTenant } from './34-og2-tenant.js';

const PUSH_DEBOUNCE_MS = 1500;
let _hub = null;          // { origin, tenant } or false (no hub)
let _pushTimer = null;
let _pushing = null;      // in-flight push promise
let _pushAgain = null;    // reason queued while a push runs

// Tenant from the served path (/t/<name>/…); null under file:// or plain /.
export function og2HubTenantOf(loc = typeof location !== 'undefined' ? location : null) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return null;
  const m = /^\/t\/([^/]+)\/?/.exec(loc.pathname || '');
  return m ? decodeURIComponent(m[1]) : null;
}

// Pure decision: restore the hub export when it is newer than what this
// profile last synced (or the profile never synced and the hub has one).
export function og2SyncDecision(marker, manifest) {
  if (!manifest || !manifest.exportedAt) return { restore: false, reason: 'hub has no export' };
  if (!marker || !marker.exportedAt) return { restore: true, reason: 'never synced' };
  if (manifest.exportedAt > marker.exportedAt) return { restore: true, reason: 'hub is newer' };
  return { restore: false, reason: manifest.exportedAt === marker.exportedAt ? 'in sync' : 'local is newer' };
}

async function hub() {
  if (_hub !== null) return _hub || null;
  const tenant = og2HubTenantOf();
  if (!tenant) { _hub = false; return null; }
  try {
    const res = await fetch(`${location.origin}/api/hub`, { cache: 'no-store' });
    const info = res.ok ? await res.json() : null;
    _hub = info && Array.isArray(info.tenants) && info.tenants.includes(tenant) ? { origin: location.origin, tenant } : false;
    if (!_hub) og2SyncStatus('error', `Hub kennt Mandant «${tenant}» nicht`);
  } catch { _hub = false; }
  return _hub || null;
}
export function og2HubActive() { return !!_hub; }

const api = (h, path) => `${h.origin}/api/tenants/${encodeURIComponent(h.tenant)}${path}`;

// Make the served tenant the ACTIVE profile (created when missing), so a hub
// tenant never lands in whatever profile was active last.
async function ensureTenantProfile(tenant) {
  const list = await listProfiles();
  const hit = list.find((p) => p.id === tenant || p.name === tenant);
  const active = await getActiveProfileId();
  if (hit) { if (hit.id !== active) await switchProfile(hit.id); return hit.id; }
  return createProfile(tenant, { activate: true, source: 'hub' });
}

// Boot: pull. Returns { hub, restored, reason }.
export async function og2SyncPull() {
  const h = await hub();
  if (!h) return { hub: false };
  await ensureTenantProfile(h.tenant);
  og2SyncStatus('busy', 'Sync: hole Stand …');
  try {
    const res = await fetch(api(h, '/manifest'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const { manifest, pull } = await res.json();
    const marker = await getStoredJson(KEY_SYNC);
    const decision = og2SyncDecision(marker, manifest);
    if (!decision.restore) {
      og2SyncStatus('ok', `Sync: ${decision.reason === 'in sync' ? 'aktuell' : decision.reason === 'local is newer' ? 'lokal neuer' : 'kein Export im Repo'}${pull && pull.pulled ? ' (gepullt)' : ''}`);
      return { hub: true, restored: false, reason: decision.reason };
    }
    og2SyncStatus('busy', 'Sync: lade Export …');
    const zip = await fetch(api(h, '/export'), { cache: 'no-store' });
    if (!zip.ok) throw new Error(`export ${zip.status}`);
    const file = new File([await zip.arrayBuffer()], 'tenant.zip', { type: 'application/zip' });
    const entries = await readZipEntries(file);
    const restored = await og2RestoreTenant(entries);
    await putStored(KEY_SYNC, JSON.stringify({ tenant: h.tenant, exportedAt: restored.exportedAt, syncedAt: new Date().toISOString() }));
    og2SyncStatus('ok', `Sync: Stand ${restored.exportedAt} übernommen`);
    return { hub: true, restored: true, reason: decision.reason, manifest: restored };
  } catch (err) {
    console.error('[sync] pull', err);
    og2SyncStatus('error', `Sync: Pull fehlgeschlagen (${err.message})`);
    return { hub: true, restored: false, error: String(err) };
  }
}

// After a change: push (debounced; a change during a push queues one more).
export function og2SyncPushSoon(reason = 'change') {
  if (_hub === false) return;
  if (_pushing) { _pushAgain = reason; return; }
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => { og2SyncPush(reason); }, PUSH_DEBOUNCE_MS);
}

export async function og2SyncPush(reason = 'change') {
  const h = await hub();
  if (!h) return null;
  if (_pushing) { _pushAgain = reason; return _pushing; }
  _pushing = (async () => {
    og2SyncStatus('busy', 'Sync: sende …');
    try {
      const { bytes, manifest } = await og2BuildTenantZip();
      const res = await fetch(`${api(h, '/export')}?reason=${encodeURIComponent(reason)}`, { method: 'PUT', body: bytes, headers: { 'Content-Type': 'application/zip' } });
      const out = res.ok ? await res.json() : null;
      if (!res.ok) throw new Error((out && out.error) || `PUT ${res.status}`);
      await putStored(KEY_SYNC, JSON.stringify({ tenant: h.tenant, exportedAt: manifest.exportedAt, syncedAt: new Date().toISOString() }));
      const git = out.git || {};
      const at = manifest.exportedAt.slice(11, 16);
      if (git.pushed) og2SyncStatus('ok', `Sync: gepusht ${at} UTC`);
      else if (git.committed && git.remote === false) og2SyncStatus('ok', `Sync: committet ${at} UTC (kein Remote)`);
      else if (git.committed) og2SyncStatus('warn', `Sync: committet, Push offen${git.pushError ? ' (' + git.pushError.slice(0, 60) + ')' : ''}`);
      else og2SyncStatus('ok', 'Sync: unverändert');
      return out;
    } catch (err) {
      console.error('[sync] push', err);
      og2SyncStatus('error', `Sync: Push fehlgeschlagen (${err.message})`);
      return null;
    } finally {
      _pushing = null;
      if (_pushAgain) { const again = _pushAgain; _pushAgain = null; og2SyncPushSoon(again); }
    }
  })();
  return _pushing;
}

// Raw inputs the app received (snapshot files, lists) go to the repo as well.
export async function og2SyncArchiveRaw(filename, text) {
  const h = await hub();
  if (!h) return null;
  try {
    const res = await fetch(api(h, `/snapshots/${encodeURIComponent(filename)}`), { method: 'POST', body: text, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!res.ok) throw new Error(`POST ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[sync] archive', filename, err);
    og2SyncStatus('warn', `Sync: Rohdatei ${filename} nicht archiviert`);
    return null;
  }
}

/* v8 ignore start */
// Footer indicator next to the status line.
export function og2SyncStatus(level, text) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('syncStatus');
  if (!el) {
    const status = document.querySelector(typeof STATUS_ID === 'string' ? STATUS_ID : '#status');
    if (!status || !status.parentNode) return;
    const sep = document.createElement('span');
    sep.className = 'stat-separator';
    sep.textContent = '|';
    el = document.createElement('span');
    el.id = 'syncStatus';
    el.className = 'sync-status';
    el.title = 'Mandanten-Repo (Hub): Pull beim Laden, Push nach jeder Änderung — Klick: jetzt pushen';
    el.addEventListener('click', () => og2SyncPush('manual'));
    status.parentNode.insertBefore(sep, status.nextSibling);
    status.parentNode.insertBefore(el, sep.nextSibling);
  }
  el.dataset.level = level;
  el.textContent = text;
}
/* v8 ignore stop */
