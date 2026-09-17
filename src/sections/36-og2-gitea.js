// OrgGraph 2.0 — Gitea contents client (E77): the tenant repo is written and
// read through Gitea's REST API alone — every write is a real git commit made
// by the server (one commit per call, several files), reads are the contents
// listing (shas) and the raw endpoint (bytes). No git protocol, no proxy: the
// server must answer CORS (Gitea [cors] ENABLED, ALLOW_DOMAIN = *) because the
// app runs from file:// (origin "null"). Pure fetch, testable in node.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// base64 of arbitrary bytes without btoa's string round trip (large ZIPs)
export function bytesToBase64(bytes) {
  let out = '';
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += B64[(triple >> 18) & 63] + B64[(triple >> 12) & 63]
      + (i + 1 < n ? B64[(triple >> 6) & 63] : '=') + (i + 2 < n ? B64[triple & 63] : '=');
  }
  return out;
}

export function base64ToBytes(text) {
  const clean = String(text || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12)
      | ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (v >> 16) & 255;
    if (o < out.length) out[o++] = (v >> 8) & 255;
    if (o < out.length) out[o++] = v & 255;
  }
  return out;
}

// Normalise what the user typed: base URL without trailing slash, owner/repo
// also accepted as one "owner/repo" string or a full repo URL.
export function normalizeRepoConfig(cfg = {}) {
  let base = String(cfg.base || '').trim().replace(/\/+$/, '');
  let owner = String(cfg.owner || '').trim();
  let repo = String(cfg.repo || '').trim().replace(/\.git$/, '');
  const m = /^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(base);
  if (m && !owner && !repo) { base = m[1]; owner = m[2]; repo = m[3]; }
  if (owner.includes('/') && !repo) [owner, repo] = owner.split('/');
  return {
    base, owner, repo,
    branch: String(cfg.branch || 'main').trim() || 'main',
    token: String(cfg.token || '').trim(),
    identity: String(cfg.identity || '').trim(),
  };
}

export function repoConfigComplete(cfg) {
  const c = normalizeRepoConfig(cfg);
  return !!(c.base && c.owner && c.repo && c.token);
}

export class GiteaError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

export function giteaClient(config, fetchImpl = (typeof fetch === 'function' ? fetch : null)) {
  const cfg = normalizeRepoConfig(config);
  if (!fetchImpl) throw new Error('fetch fehlt');
  const repoApi = `${cfg.base}/api/v1/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const encPath = (p) => String(p || '').split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const headers = (extra = {}) => ({ Accept: 'application/json', ...(cfg.token ? { Authorization: `token ${cfg.token}` } : {}), ...extra });
  const call = async (method, url, body) => {
    let res;
    try {
      res = await fetchImpl(url, { method, headers: headers(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    } catch (err) {
      throw new GiteaError(`Gitea nicht erreichbar (${err.message}) — CORS auf dem Server aktiv?`, 0, String(err));
    }
    if (res.status === 404) return null;
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) throw new GiteaError((json && json.message) || `${method} ${url}: ${res.status}`, res.status, json || text);
    return json;
  };
  return {
    config: cfg,
    repoApi,
    // repository metadata (also the connection test)
    async repo() { return call('GET', repoApi); },
    // a directory listing: [{ name, path, sha, type, size }]; [] when missing
    async list(dir = '') {
      const out = await call('GET', `${repoApi}/contents/${encPath(dir)}?ref=${encodeURIComponent(cfg.branch)}`);
      return Array.isArray(out) ? out.map((e) => ({ name: e.name, path: e.path, sha: e.sha, type: e.type, size: e.size })) : [];
    },
    // a small text file via the contents endpoint (base64 in JSON); null when missing
    async readText(path) {
      const out = await call('GET', `${repoApi}/contents/${encPath(path)}?ref=${encodeURIComponent(cfg.branch)}`);
      if (!out || Array.isArray(out)) return null;
      return { sha: out.sha, text: new TextDecoder().decode(base64ToBytes(out.content || '')) };
    },
    // raw bytes of any size; null when missing
    async readBytes(path) {
      let res;
      try {
        res = await fetchImpl(`${repoApi}/raw/${encPath(path)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers({ Accept: '*/*' }), cache: 'no-store' });
      } catch (err) {
        throw new GiteaError(`Gitea nicht erreichbar (${err.message})`, 0, String(err));
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new GiteaError(`raw ${path}: ${res.status}`, res.status, await res.text());
      return new Uint8Array(await res.arrayBuffer());
    },
    // ONE commit with several files: files = [{ path, data: string|Uint8Array, sha? }]
    // (sha present → update, else create). Returns the commit { sha, url }.
    async commit(files, message) {
      const body = {
        branch: cfg.branch,
        message,
        files: files.map((f) => ({
          operation: f.sha ? 'update' : 'create',
          path: f.path,
          content: bytesToBase64(typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data),
          ...(f.sha ? { sha: f.sha } : {}),
        })),
      };
      const out = await call('POST', `${repoApi}/contents`, body);
      return out && out.commit ? { sha: out.commit.sha, url: out.commit.html_url || null, files: (out.files || []).map((x) => ({ path: x.path, sha: x.sha })) } : out;
    },
  };
}
