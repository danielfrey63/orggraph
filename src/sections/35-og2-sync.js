// OrgGraph 2.0 — tenant repo sync (E77): the active profile can be bound to a
// private Gitea repo (URL, owner/repo, token, age identity — all kept in the
// profile). Every load pulls: the repo's manifest is compared with what this
// profile last synced and a newer export is decrypted and restored BEFORE the
// boot. Every change pushes: the tenant ZIP is age-encrypted in the browser
// and committed through Gitea's contents API — a real commit per push, made
// by the server. Without a binding nothing here runs (offline single file).
import { KEY_SYNC, KEY_REPO, getStoredJson, putStored, delStored } from './04-storage.js';
import { readZipEntries } from './05-dropzone.js';
import { og2BuildTenantZip, og2RestoreTenant, og2TenantName } from './34-og2-tenant.js';
import { giteaClient, normalizeRepoConfig, repoConfigComplete } from './36-og2-gitea.js';

const PUSH_DEBOUNCE_MS = 1500;
const REPO_MANIFEST = 'manifest.json';
const REPO_EXPORT = 'tenant.zip.age';
const REPO_TENANT_CONFIG = 'config.json';
const REPO_SNAPSHOT_DIR = 'snapshots';
let _pushTimer = null;
let _pushing = null;
let _pushAgain = null;

// Pure decision: restore the repo export when it is newer than what this
// profile last synced (or the profile never synced and the repo has one).
export function og2SyncDecision(marker, manifest) {
  if (!manifest || !manifest.exportedAt) return { restore: false, reason: 'repo has no export' };
  if (!marker || !marker.exportedAt) return { restore: true, reason: 'never synced' };
  if (manifest.exportedAt > marker.exportedAt) return { restore: true, reason: 'repo is newer' };
  return { restore: false, reason: manifest.exportedAt === marker.exportedAt ? 'in sync' : 'local is newer' };
}

// ---- binding (per profile) -----------------------------------------------------
export async function og2RepoConfig() {
  const raw = await getStoredJson(KEY_REPO);
  return raw && repoConfigComplete(raw) ? normalizeRepoConfig(raw) : null;
}
export async function og2RepoConfigRaw() { return (await getStoredJson(KEY_REPO)) || null; }
export async function og2SaveRepoConfig(cfg) {
  if (!cfg) { await delStored(KEY_REPO); await delStored(KEY_SYNC); return null; }
  const norm = normalizeRepoConfig(cfg);
  await putStored(KEY_REPO, JSON.stringify(norm));
  return norm;
}
export const og2SafeFilename = (name) => (String(name || '').split(/[\\/]/).pop() || 'file').replace(/[^A-Za-z0-9._@-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 180) || 'file';

// ---- age (vendor/age.min.js, global `age`; injectable for tests) ------------------
const ageLib = () => (typeof age !== 'undefined' ? age : (globalThis.age || null));
export async function og2AgeEncrypt(bytes, recipients) {
  const lib = ageLib();
  if (!lib) throw new Error('age-Bibliothek fehlt');
  const e = new lib.Encrypter();
  for (const r of recipients) e.addRecipient(r);
  return e.encrypt(bytes);
}
export async function og2AgeDecrypt(bytes, identity) {
  const lib = ageLib();
  if (!lib) throw new Error('age-Bibliothek fehlt');
  const d = new lib.Decrypter();
  d.addIdentity(identity);
  return d.decrypt(bytes);
}
export async function og2AgeRecipientOf(identity) {
  const lib = ageLib();
  return lib && identity ? lib.identityToRecipient(identity) : null;
}
export async function og2AgeGenerateIdentity() { return ageLib().generateIdentity(); }

// recipients the repo declares (config.json), falling back to our own key;
// a missing config.json is created on the first push (bootstrap of an empty repo)
async function recipientsFor(client, cfg) {
  const conf = await client.readText(REPO_TENANT_CONFIG);
  let parsed = null;
  try { parsed = conf ? JSON.parse(conf.text) : null; } catch { parsed = null; }
  const own = cfg.identity ? await og2AgeRecipientOf(cfg.identity) : null;
  const listed = parsed && Array.isArray(parsed.recipients) ? parsed.recipients.filter(Boolean) : [];
  if (listed.length) return { recipients: listed, ownIncluded: !own || listed.includes(own), bootstrap: null, sha: conf.sha };
  if (!own) throw new Error('keine age-Empfänger: config.json im Repo fehlt und keine Identität hinterlegt');
  return { recipients: [own], ownIncluded: true, bootstrap: { path: REPO_TENANT_CONFIG, data: JSON.stringify({ tenant: await og2TenantName(), recipients: [own] }, null, 2) + '\n', sha: conf ? conf.sha : undefined }, sha: conf ? conf.sha : undefined };
}

const shaOf = (listing, name) => { const e = (listing || []).find((x) => x.name === name); return e ? e.sha : undefined; };

// ---- pull (boot) ------------------------------------------------------------------
export async function og2SyncPull({ force = false } = {}) {
  const cfg = await og2RepoConfig();
  if (!cfg) { og2SyncStatus('off', 'Repo: nicht verbunden'); return { bound: false }; }
  const client = giteaClient(cfg);
  og2SyncStatus('busy', 'Repo: hole Stand …');
  try {
    const listing = await client.list('');
    const manifestText = shaOf(listing, REPO_MANIFEST) ? await client.readText(REPO_MANIFEST) : null;
    const manifest = manifestText ? JSON.parse(manifestText.text) : null;
    const marker = await getStoredJson(KEY_SYNC);
    const decision = og2SyncDecision(force ? null : marker, manifest);
    if (!decision.restore) {
      og2SyncStatus('ok', `Repo: ${decision.reason === 'in sync' ? 'aktuell' : decision.reason === 'local is newer' ? 'lokal neuer' : 'kein Export im Repo'}`);
      return { bound: true, restored: false, reason: decision.reason, manifest };
    }
    if (!cfg.identity) throw new Error('age-Identität fehlt — im Repo-Dialog hinterlegen');
    og2SyncStatus('busy', 'Repo: lade Export …');
    const enc = await client.readBytes(REPO_EXPORT);
    if (!enc) throw new Error(`${REPO_EXPORT} fehlt im Repo`);
    const plain = await og2AgeDecrypt(enc, cfg.identity);
    const entries = await readZipEntries({ name: REPO_EXPORT, arrayBuffer: async () => plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) });
    const restored = await og2RestoreTenant(entries);
    await putStored(KEY_SYNC, JSON.stringify({ exportedAt: restored.exportedAt, syncedAt: new Date().toISOString() }));
    og2SyncStatus('ok', `Repo: Stand ${restored.exportedAt} übernommen`);
    return { bound: true, restored: true, reason: decision.reason, manifest: restored };
  } catch (err) {
    console.error('[sync] pull', err);
    og2SyncStatus('error', `Repo: Pull fehlgeschlagen (${err.message})`);
    return { bound: true, restored: false, error: String(err && err.message || err) };
  }
}

// ---- push (after changes) ------------------------------------------------------------
export function og2SyncPushSoon(reason = 'change') {
  if (_pushing) { _pushAgain = reason; return; }
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(() => { og2SyncPush(reason); }, PUSH_DEBOUNCE_MS);
}

export async function og2SyncPush(reason = 'change') {
  const cfg = await og2RepoConfig();
  if (!cfg) return null;
  if (_pushing) { _pushAgain = reason; return _pushing; }
  _pushing = (async () => {
    og2SyncStatus('busy', 'Repo: sende …');
    try {
      const client = giteaClient(cfg);
      const { bytes, manifest } = await og2BuildTenantZip();
      const { recipients, ownIncluded, bootstrap } = await recipientsFor(client, cfg);
      const enc = await og2AgeEncrypt(bytes, recipients);
      const listing = await client.list('');
      const stored = { ...manifest, storedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), reason, bytes: bytes.length, recipients: recipients.length };
      const files = [
        { path: REPO_MANIFEST, data: JSON.stringify(stored, null, 2) + '\n', sha: shaOf(listing, REPO_MANIFEST) },
        { path: REPO_EXPORT, data: enc, sha: shaOf(listing, REPO_EXPORT) },
      ];
      if (bootstrap) files.push(bootstrap);
      const commit = await client.commit(files, `${manifest.tenant}: ${reason} (${manifest.exportedAt})`);
      await putStored(KEY_SYNC, JSON.stringify({ exportedAt: manifest.exportedAt, syncedAt: new Date().toISOString(), commit: commit && commit.sha }));
      const at = manifest.exportedAt.slice(11, 16);
      og2SyncStatus(ownIncluded ? 'ok' : 'warn', ownIncluded ? `Repo: committet ${at} UTC` : `Repo: committet ${at} UTC — eigener Schlüssel ist kein Empfänger`);
      return commit;
    } catch (err) {
      console.error('[sync] push', err);
      const conflict = err && (err.status === 409 || err.status === 422);
      og2SyncStatus('error', conflict ? 'Repo: Konflikt — Repo hat einen neueren Stand, Seite neu laden' : `Repo: Push fehlgeschlagen (${err.message})`);
      return null;
    } finally {
      _pushing = null;
      if (_pushAgain) { const again = _pushAgain; _pushAgain = null; og2SyncPushSoon(again); }
    }
  })();
  return _pushing;
}

// Raw inputs the app received (snapshot files, lists): snapshots/<name>.age
export async function og2SyncArchiveRaw(filename, text) {
  const cfg = await og2RepoConfig();
  if (!cfg) return null;
  try {
    const client = giteaClient(cfg);
    const { recipients, bootstrap } = await recipientsFor(client, cfg);
    const name = `${REPO_SNAPSHOT_DIR}/${og2SafeFilename(filename)}.age`;
    const enc = await og2AgeEncrypt(new TextEncoder().encode(text), recipients);
    const sha = shaOf(await client.list(REPO_SNAPSHOT_DIR), `${og2SafeFilename(filename)}.age`);
    const files = [{ path: name, data: enc, sha }];
    if (bootstrap) files.push(bootstrap);
    return await client.commit(files, `${await og2TenantName()}: snapshot ${og2SafeFilename(filename)}`);
  } catch (err) {
    console.error('[sync] archive', filename, err);
    og2SyncStatus('warn', `Repo: Rohdatei ${filename} nicht archiviert (${err.message})`);
    return null;
  }
}

/* v8 ignore start */
// Footer indicator next to the status line; click opens the repo dialog.
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
    el.title = 'Mandanten-Repo (E77): Pull beim Laden, Commit nach jeder Änderung — Klick: Verbindung';
    el.addEventListener('click', () => { if (typeof og2OpenRepoDialog === 'function') og2OpenRepoDialog(); });
    status.parentNode.insertBefore(sep, status.nextSibling);
    status.parentNode.insertBefore(el, sep.nextSibling);
  }
  el.dataset.level = level;
  el.textContent = text;
}
/* v8 ignore stop */
