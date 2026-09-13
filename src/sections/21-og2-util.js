// OrgGraph 2.0 engine — shared utilities (PRD §5, §6.3).
// Type-agnostic (NFR-5): no canonical type name appears in this file.

// Canonical JSON: deterministic serialization with sorted object keys.
// Used for edge keys (FR-6.3), scope fingerprints (E49) and content hashes (FR-6.9).
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

// FNV-1a 64-bit over a string, hex-encoded. Dependency-free stand-in for the
// canonical content hash (FR-6.9) — the PRD fixes the hashed payload, not the
// algorithm; collisions only risk a false no-op, acceptable for v1 local use.
export function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

// Snapshot instants are YYYYMMDD-HHMM stamps (FR-5.2a); lexicographic order
// equals chronological order, so plain string comparison is the comparator.
export function instantCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

const INSTANT_RE = /^\d{8}-\d{4}$/;
export function isValidInstant(stamp) {
  return typeof stamp === 'string' && INSTANT_RE.test(stamp);
}

// UTC minute of an RFC3339 timestamp as a snapshot stamp, or null when the
// timestamp is offsetless/invalid (E50: offsetless values are rejected).
export function utcMinuteOf(rfc3339) {
  if (typeof rfc3339 !== 'string') return null;
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(rfc3339)) return null;
  const ms = Date.parse(rfc3339);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const p = (n, w) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1, 2)}${p(d.getUTCDate(), 2)}-${p(d.getUTCHours(), 2)}${p(d.getUTCMinutes(), 2)}`;
}

// Normalized deep compare for props stands (FR-5.6c): key order is irrelevant,
// scalar values compare strictly.
export function deepEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

export function sortedUnique(arr) {
  return [...new Set(arr)].sort();
}

// Structured clone for plain JSON-ish data plus Map/Set (store snapshots for
// atomic apply, FR-6.9a).
export function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Map) {
    const m = new Map();
    for (const [k, v] of value) m.set(k, deepClone(v));
    return m;
  }
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return value.map(deepClone);
  const out = {};
  for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
  return out;
}

// Scalar check for props values (FR-4.5): string, number, boolean or null.
export function isScalar(v) {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

// Slug for fallback ids (E41/E56): NFC, lower-case, every non-letter/digit
// run collapsed to one dash. Shared by the legacy migration and the in-app
// list intake so both derive the same container-node identity (E72).
export function slug(text) {
  return String(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

// Levenshtein distance — the fuzzy fallback of identifier matching before an
// export (FR-10.4, `identifiers` capability: matching happens before the
// snapshot exists, never inside the import).
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Length-normalized Levenshtein distance in [0, 1].
export function normalizedDistance(a, b) {
  const max = Math.max(a.length, b.length);
  return max ? levenshtein(a, b) / max : 0;
}
