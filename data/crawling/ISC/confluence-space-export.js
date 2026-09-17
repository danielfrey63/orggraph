/**
 * Confluence space export (ISC) — one XML file per page, bundled as a ZIP.
 *
 * Read-only harvesting script in the sense of PRD E26: run it in the DevTools
 * console *on the Confluence origin* while logged in. It talks to the Confluence
 * REST API with the browser session (same-origin, no token), pages through every
 * current page of a space, wraps each page (title, hierarchy, labels, version,
 * storage-format body) in a small XML document and downloads everything as one
 * ZIP archive. Nothing is written to Confluence.
 *
 *   await cfx.probe()                          // detect base URL + space, count pages/attachments
 *   await cfx.probe({ exclude: ['123456'] })   // …minus the excluded subtree(s): expected export size
 *   await cfx.run()                            // export the space of the open page
 *   await cfx.run({ spaceKey: 'ISC' })         // export a specific space
 *   await cfx.run({ exclude: ['123456'] })     // skip a parent page and its whole subtree
 *   await cfx.run({ attachments: false })      // page XML only, attachments listed as metadata
 *   await cfx.run({ maxAttachmentBytes: 10 * 1024 * 1024 })
 *   await cfx.run({ types: ['page', 'blogpost'] })
 *
 * Archive layout (<spaceKey>-<yyyymmdd-hhmm>.zip):
 *   index.xml                        manifest: page tree (id, parentId, title, path), excluded roots
 *   pages/<id>-<slug>.xml            one document per page, incl. its attachment list
 *   attachments/<pageId>/<filename>  the attachment binaries (images, PDFs, Office, …)
 *   blogposts/<id>-<slug>.xml        only with types: ['page', 'blogpost']
 *
 * Attachments above maxAttachmentBytes (default 50 MB) or failing to download stay
 * listed in the page XML with a `skipped` attribute. The whole ZIP is assembled in
 * browser memory, so keep an eye on the attachment volume of very large spaces.
 *
 * The storage-format body is embedded verbatim inside a CDATA section: Confluence
 * storage XHTML uses HTML entities (&nbsp;, …) and ac:/ri: prefixes that would
 * not be well-formed on their own. Consumers take <body> text as-is.
 *
 * Works on Confluence Server / Data Center (/rest/api) and Cloud (/wiki/rest/api);
 * the base path is detected from the page. Re-running is harmless: the script
 * only reads and produces a fresh download.
 */
(function () {
  'use strict';

  const CONFIG = {
    PAGE_SIZE: 50,          // items per REST call (Confluence caps body expansions around here)
    DELAY_MS: 150,          // pause between REST calls
    MAX_RETRIES: 4,         // on 429 / 5xx / network errors
    RETRY_BASE_MS: 1500,
    EXPAND: 'body.storage,version,ancestors,metadata.labels,history,space',
    ATTACHMENTS: true,                    // download attachments into attachments/<pageId>/
    MAX_ATTACHMENT_BYTES: 50 * 1024 * 1024, // larger files are listed as metadata only
    ZIP_MAX_ENTRIES: 65535,               // classic ZIP limit (no ZIP64)
  };

  // ---------------------------------------------------------------- environment

  const hasDom = typeof document !== 'undefined' && typeof location !== 'undefined';

  function metaContent(name) {
    if (!hasDom) return null;
    const el = document.querySelector(`meta[name="${name}"]`);
    return el ? el.getAttribute('content') : null;
  }

  /** REST base, e.g. "https://host/confluence/rest/api" or "https://host/wiki/rest/api". */
  function detectApiBase() {
    if (!hasDom) return '/rest/api';
    const ctx = metaContent('ajs-context-path');
    if (ctx !== null) return `${location.origin}${ctx}/rest/api`;
    if (location.pathname.startsWith('/wiki/')) return `${location.origin}/wiki/rest/api`;
    return `${location.origin}/rest/api`;
  }

  /** Web base for page URLs (origin + context path). */
  function detectWebBase() {
    if (!hasDom) return '';
    const ctx = metaContent('ajs-context-path');
    if (ctx !== null) return `${location.origin}${ctx}`;
    if (location.pathname.startsWith('/wiki/')) return `${location.origin}/wiki`;
    return location.origin;
  }

  function detectSpaceKey() {
    if (!hasDom) return null;
    const meta = metaContent('ajs-space-key');
    if (meta) return meta;
    const m = location.pathname.match(/\/(?:display|spaces)\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ---------------------------------------------------------------- http

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function getJson(url, attempt = 0) {
    let res;
    try {
      res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
    } catch (err) {
      if (attempt >= CONFIG.MAX_RETRIES) throw err;
      await sleep(CONFIG.RETRY_BASE_MS * 2 ** attempt);
      return getJson(url, attempt + 1);
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < CONFIG.MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After')) * 1000;
      await sleep(retryAfter > 0 ? retryAfter : CONFIG.RETRY_BASE_MS * 2 ** attempt);
      return getJson(url, attempt + 1);
    }
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}${text ? ` — ${text.slice(0, 200)}` : ''}`);
  }

  /** Iterate every content item of a space and type, following start/limit pagination. */
  async function* listContent(apiBase, spaceKey, type, onPage) {
    let start = 0;
    for (;;) {
      const url = `${apiBase}/content?spaceKey=${encodeURIComponent(spaceKey)}&type=${type}` +
        `&status=current&start=${start}&limit=${CONFIG.PAGE_SIZE}&expand=${encodeURIComponent(CONFIG.EXPAND)}`;
      const json = await getJson(url);
      const results = json.results || [];
      for (const item of results) yield item;
      if (onPage) onPage(results.length, start);
      const size = json.size ?? results.length;
      const hasNext = Boolean(json._links && json._links.next) || size >= (json.limit ?? CONFIG.PAGE_SIZE);
      if (!hasNext || size === 0) return;
      start += size;
      await sleep(CONFIG.DELAY_MS);
    }
  }

  /** Fetch a binary (attachment download) with the session; retries like getJson. */
  async function getBytes(url, attempt = 0) {
    let res;
    try {
      res = await fetch(url, { credentials: 'include' });
    } catch (err) {
      if (attempt >= CONFIG.MAX_RETRIES) throw err;
      await sleep(CONFIG.RETRY_BASE_MS * 2 ** attempt);
      return getBytes(url, attempt + 1);
    }
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    if ((res.status === 429 || res.status >= 500) && attempt < CONFIG.MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('Retry-After')) * 1000;
      await sleep(retryAfter > 0 ? retryAfter : CONFIG.RETRY_BASE_MS * 2 ** attempt);
      return getBytes(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  /** All attachments of one content item (paginated). */
  async function listAttachments(apiBase, contentId) {
    const out = [];
    let start = 0;
    for (;;) {
      const url = `${apiBase}/content/${encodeURIComponent(contentId)}/child/attachment` +
        `?start=${start}&limit=${CONFIG.PAGE_SIZE}&expand=version,metadata`;
      const json = await getJson(url);
      const results = json.results || [];
      out.push(...results);
      const size = json.size ?? results.length;
      const hasNext = Boolean(json._links && json._links.next) || size >= (json.limit ?? CONFIG.PAGE_SIZE);
      if (!hasNext || size === 0) return out;
      start += size;
      await sleep(CONFIG.DELAY_MS);
    }
  }

  /** totalSize of a CQL query, or null when the search endpoint does not answer. */
  async function countCql(apiBase, cql) {
    try {
      const json = await getJson(`${apiBase}/content/search?cql=${encodeURIComponent(cql)}&limit=0`);
      return typeof json.totalSize === 'number' ? json.totalSize : null;
    } catch {
      return null;
    }
  }

  function spaceCql(spaceKey, type, extra) {
    return `space="${spaceKey.replace(/"/g, '\\"')}" and type=${type}${extra ? ` and ${extra}` : ''}`;
  }

  async function countContent(apiBase, spaceKey, type, extra) {
    return countCql(apiBase, spaceCql(spaceKey, type, extra));
  }

  // ---------------------------------------------------------------- xml

  const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

  /** XML-escape text; drops C0 control characters that XML 1.0 forbids (tab, LF, CR stay). */
  function esc(s) {
    return Array.from(String(s ?? ''), (ch) => {
      const c = ch.charCodeAt(0);
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) return '';
      if (ch === '&') return '&amp;';
      if (ch === '<') return '&lt;';
      if (ch === '>') return '&gt;';
      if (ch === '"') return '&quot;';
      return ch;
    }).join('');
  }

  function cdata(s) {
    return `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
  }

  function slug(title) {
    return String(title || '')
      .normalize('NFKD').split('').filter((ch) => ch.charCodeAt(0) < 768 || ch.charCodeAt(0) > 879).join('') // strip combining marks U+0300–U+036F
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 80).toLowerCase() || 'untitled';
  }

  function pageUrl(webBase, item) {
    const webui = item._links && item._links.webui;
    return webui ? `${webBase}${webui}` : '';
  }

  /** File name safe for a ZIP entry: no path separators, no control characters. */
  function safeFileName(name) {
    const cleaned = Array.from(String(name || ''), (ch) => {
      const c = ch.charCodeAt(0);
      if (c < 32 || ch === '/' || ch === '\\' || ch === ':' || ch === '*' || ch === '?' ||
        ch === '"' || ch === '<' || ch === '>' || ch === '|') return '_';
      return ch;
    }).join('').trim();
    return cleaned || 'unnamed';
  }

  /**
   * Build the XML document for one content item. `attachments` is the list
   * prepared by collectAttachments (may be empty).
   */
  function buildPageXml(item, ctx, attachments = []) {
    const ancestors = item.ancestors || [];
    const parent = ancestors.length ? ancestors[ancestors.length - 1] : null;
    const labels = (item.metadata && item.metadata.labels && item.metadata.labels.results) || [];
    const version = item.version || {};
    const history = item.history || {};
    const createdBy = history.createdBy || {};
    const versionBy = version.by || {};
    const body = (item.body && item.body.storage && item.body.storage.value) || '';

    const lines = [];
    lines.push(XML_DECL);
    lines.push(`<${item.type || 'page'} id="${esc(item.id)}" space="${esc(ctx.spaceKey)}"` +
      `${parent ? ` parentId="${esc(parent.id)}"` : ''} version="${esc(version.number ?? '')}"` +
      ` status="${esc(item.status || 'current')}" exportedAt="${esc(ctx.crawledAt)}">`);
    lines.push(`  <title>${esc(item.title)}</title>`);
    lines.push(`  <url>${esc(pageUrl(ctx.webBase, item))}</url>`);
    lines.push(`  <created at="${esc(history.createdDate || '')}" by="${esc(createdBy.displayName || '')}"` +
      ` userKey="${esc(createdBy.userKey || createdBy.accountId || '')}"/>`);
    lines.push(`  <lastModified at="${esc(version.when || '')}" by="${esc(versionBy.displayName || '')}"` +
      ` userKey="${esc(versionBy.userKey || versionBy.accountId || '')}"` +
      `${version.message ? ` message="${esc(version.message)}"` : ''}/>`);
    lines.push('  <ancestors>');
    for (const a of ancestors) lines.push(`    <ancestor id="${esc(a.id)}">${esc(a.title)}</ancestor>`);
    lines.push('  </ancestors>');
    lines.push('  <labels>');
    for (const l of labels) lines.push(`    <label prefix="${esc(l.prefix || '')}">${esc(l.name)}</label>`);
    lines.push('  </labels>');
    lines.push('  <attachments>');
    for (const a of attachments) {
      lines.push(`    <attachment id="${esc(a.id)}" filename="${esc(a.filename)}" mediaType="${esc(a.mediaType)}"` +
        ` size="${esc(a.size)}" version="${esc(a.version)}" modified="${esc(a.modified)}"` +
        `${a.path ? ` path="${esc(a.path)}"` : ''}${a.skipped ? ` skipped="${esc(a.skipped)}"` : ''}` +
        ` url="${esc(a.url)}"${a.comment ? ` comment="${esc(a.comment)}"` : ''}/>`);
    }
    lines.push('  </attachments>');
    lines.push(`  <body representation="storage">${cdata(body)}</body>`);
    lines.push(`</${item.type || 'page'}>\n`);
    return lines.join('\n');
  }

  /** Manifest with the flat page list; the tree is implied by parentId. */
  function buildIndexXml(entries, ctx) {
    const lines = [XML_DECL];
    lines.push(`<space key="${esc(ctx.spaceKey)}" name="${esc(ctx.spaceName || '')}"` +
      ` base="${esc(ctx.webBase)}" exportedAt="${esc(ctx.crawledAt)}" count="${entries.length}"` +
      ` attachments="${ctx.attachmentCount ?? 0}">`);
    for (const ex of ctx.excluded || []) {
      lines.push(`  <excluded id="${esc(ex.id)}" skipped="${ex.skipped}">${esc(ex.title || '')}</excluded>`);
    }
    for (const e of entries) {
      lines.push(`  <${e.type} id="${esc(e.id)}"${e.parentId ? ` parentId="${esc(e.parentId)}"` : ''}` +
        ` version="${esc(e.version)}" attachments="${e.attachments}" path="${esc(e.path)}">${esc(e.title)}</${e.type}>`);
    }
    lines.push('</space>\n');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- zip (store / deflate-raw)

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
  }

  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null; // engine without deflate-raw → store
    }
  }

  /**
   * Build a ZIP archive from { name, text } entries. Deflate when the engine
   * offers CompressionStream('deflate-raw'), otherwise stored. Names are UTF-8 (flag bit 11).
   */
  async function buildZip(files, now = new Date()) {
    if (files.length > CONFIG.ZIP_MAX_ENTRIES) {
      throw new Error(`ZIP would have ${files.length} entries (limit ${CONFIG.ZIP_MAX_ENTRIES}); export with exclude or attachments: false`);
    }
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(now);
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.text === 'string' ? enc.encode(f.text) : f.bytes;
      const crc = crc32(data);
      // Text entries are deflated; binary attachments (images, PDFs, Office) are already compressed → store.
      const packed = data.length && typeof f.text === 'string' ? await deflateRaw(data) : null;
      const useDeflate = packed && packed.length < data.length;
      const payload = useDeflate ? packed : data;
      const method = useDeflate ? 8 : 0;

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, method, true);
      local.setUint16(10, time, true);
      local.setUint16(12, date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, payload.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, method, true);
      cd.setUint16(12, time, true);
      cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, payload.length, true);
      cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);

      parts.push(new Uint8Array(local.buffer), name, payload);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + payload.length;
    }

    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(4, 0, true);
    eocd.setUint16(6, 0, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    eocd.setUint16(20, 0, true);

    return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  // ---------------------------------------------------------------- orchestration

  function stamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  }

  /**
   * List the attachments of one content item, download those within the size
   * limit into `files` (attachments/<pageId>/<filename>) and return the metadata
   * rows for the page XML. Oversized or failed downloads stay listed with `skipped`.
   */
  async function collectAttachments(apiBase, webBase, item, maxBytes, files) {
    const rows = [];
    const usedNames = new Set();
    for (const a of await listAttachments(apiBase, item.id)) {
      const ext = a.extensions || {};
      const size = Number(ext.fileSize ?? 0);
      const downloadLink = a._links && a._links.download;
      const url = downloadLink ? `${webBase}${downloadLink}` : '';
      let filename = safeFileName(a.title);
      if (usedNames.has(filename)) filename = `${a.id}-${filename}`;
      usedNames.add(filename);
      const row = {
        id: a.id, filename, mediaType: ext.mediaType || '', size, url,
        version: (a.version && a.version.number) ?? '', modified: (a.version && a.version.when) || '',
        comment: (a.metadata && a.metadata.comment) || ext.comment || '', path: '', skipped: '',
      };
      if (!url) row.skipped = 'no-download-link';
      else if (size > maxBytes) row.skipped = 'size';
      else {
        try {
          const bytes = await getBytes(url);
          row.path = `attachments/${item.id}/${filename}`;
          row.size = bytes.length;
          files.push({ name: row.path, bytes });
        } catch (err) {
          row.skipped = `error: ${err.message}`.slice(0, 200);
          console.warn(`[cfx] attachment ${a.id} (${a.title}) on ${item.id}: ${err.message}`);
        }
        await sleep(CONFIG.DELAY_MS);
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * Count what the space holds per type and what the exclude list removes:
   * for every excluded root (not nested in another excluded root, inside the
   * space) the root itself plus all descendants via CQL `ancestor=`.
   * Returns { counts, skipped, expected, excluded } per type.
   */
  async function countScope(apiBase, spaceKey, types, exclude) {
    const counts = {};
    for (const t of types) counts[t] = await countContent(apiBase, spaceKey, t);

    const excluded = [];
    const skipped = {};
    for (const id of exclude) {
      let root;
      try {
        root = await getJson(`${apiBase}/content/${encodeURIComponent(id)}?expand=ancestors,space`);
      } catch (err) {
        console.warn(`[cfx] exclude ${id}: ${err.message}`);
        excluded.push({ id, error: err.message });
        continue;
      }
      const nested = (root.ancestors || []).some((a) => exclude.includes(String(a.id)));
      const inSpace = !root.space || root.space.key === spaceKey;
      const row = { id, title: root.title, type: root.type, nested, inSpace };
      if (!nested && inSpace) {
        for (const t of types) {
          const descendants = await countContent(apiBase, spaceKey, t, `ancestor=${id}`);
          const self = t === root.type ? 1 : 0;
          row[t] = descendants === null ? null : descendants + self;
          if (descendants !== null) skipped[t] = (skipped[t] || 0) + descendants + self;
        }
      }
      excluded.push(row);
    }
    const expected = {};
    for (const t of types) expected[t] = counts[t] === null ? null : counts[t] - (skipped[t] || 0);
    return { counts, skipped, expected, excluded };
  }

  async function probe(opts = {}) {
    const apiBase = opts.apiBase || detectApiBase();
    const spaceKey = opts.spaceKey || detectSpaceKey();
    if (!spaceKey) throw new Error('No space key: open a page of the space or pass { spaceKey }');
    const space = await getJson(`${apiBase}/space/${encodeURIComponent(spaceKey)}`);
    const types = [...(opts.types || ['page']), 'attachment'];
    const exclude = [...new Set((opts.exclude || []).map(String))];
    const { counts, skipped, expected, excluded } = await countScope(apiBase, spaceKey, types, exclude);

    const info = { apiBase, spaceKey, spaceName: space.name, counts, excluded, expected };
    console.log('[cfx] probe', info);
    for (const t of types) console.log(`[cfx] ${t}: ${counts[t]} in space, ${skipped[t] || 0} excluded → ${expected[t]} to export`);
    return info;
  }

  /**
   * Export a whole space. Options: spaceKey, types (['page'] | ['page','blogpost']),
   * apiBase, webBase, filename, download (default true). Returns { files, entries, blob }.
   */
  async function run(opts = {}) {
    const started = new Date();
    const apiBase = opts.apiBase || detectApiBase();
    const webBase = opts.webBase || detectWebBase();
    const spaceKey = opts.spaceKey || detectSpaceKey();
    if (!spaceKey) throw new Error('No space key: open a page of the space or pass { spaceKey }');
    const types = opts.types || ['page'];
    const withAttachments = opts.attachments ?? CONFIG.ATTACHMENTS;
    const maxBytes = opts.maxAttachmentBytes ?? CONFIG.MAX_ATTACHMENT_BYTES;
    const exclude = new Set((opts.exclude || []).map(String));

    const space = await getJson(`${apiBase}/space/${encodeURIComponent(spaceKey)}`);
    const ctx = { spaceKey, spaceName: space.name, webBase, crawledAt: started.toISOString(), excluded: [], attachmentCount: 0 };
    console.log(`[cfx] space ${spaceKey} (${space.name}) via ${apiBase}` +
      `${exclude.size ? `, excluding subtree(s) ${[...exclude].join(', ')}` : ''}`);

    // Expected sizes up front (space total minus excluded subtrees) so the progress
    // counter runs against the realistic target, not the whole space.
    const scope = await countScope(apiBase, spaceKey, types, [...exclude]);
    for (const type of types) {
      console.log(`[cfx] ${type}: ${scope.counts[type]} in space, ${scope.skipped[type] || 0} excluded → ${scope.expected[type]} to export`);
    }

    const files = [];
    const entries = [];
    const seen = new Set();
    const excludedRoots = new Map(); // id → { id, title, skipped }
    for (const type of types) {
      const total = scope.expected[type];
      const folder = type === 'page' ? 'pages' : `${type}s`;
      let n = 0;
      let skippedSoFar = 0;
      for await (const item of listContent(apiBase, spaceKey, type)) {
        if (seen.has(item.id)) continue; // pagination overlap guard
        seen.add(item.id);
        const ancestors = item.ancestors || [];
        const parent = ancestors.length ? ancestors[ancestors.length - 1] : null;

        // Excluded subtree: the page itself or any ancestor is on the exclude list.
        const hit = exclude.has(String(item.id)) ? item : ancestors.find((a) => exclude.has(String(a.id)));
        if (hit) {
          const root = excludedRoots.get(String(hit.id)) || { id: String(hit.id), title: hit.title, skipped: 0 };
          root.skipped++;
          skippedSoFar++;
          if (String(hit.id) === String(item.id)) root.title = item.title;
          excludedRoots.set(root.id, root);
          continue;
        }

        n++;
        const path = `${folder}/${item.id}-${slug(item.title)}.xml`;
        const attachments = withAttachments ? await collectAttachments(apiBase, webBase, item, maxBytes, files) : [];
        ctx.attachmentCount += attachments.length;
        files.push({ name: path, text: buildPageXml(item, ctx, attachments) });
        entries.push({
          type, id: item.id, parentId: parent ? parent.id : '', title: item.title,
          version: (item.version && item.version.number) ?? '', path, attachments: attachments.length,
        });
        if (n % 25 === 0 || n === total) {
          console.log(`[cfx] ${type} ${n}${total !== null ? `/${total}` : ''}${skippedSoFar ? ` (${skippedSoFar} excluded skipped)` : ''}`);
        }
      }
      console.log(`[cfx] ${type}: ${n} exported, ${skippedSoFar} excluded` +
        `${total !== null && total !== n ? ` (expected ${total} — restricted or moved pages?)` : ''}`);
    }
    ctx.excluded = [...excludedRoots.values()];
    for (const ex of ctx.excluded) console.log(`[cfx] excluded ${ex.id} "${ex.title || ''}": ${ex.skipped} item(s) skipped`);
    for (const id of exclude) if (!excludedRoots.has(id)) console.warn(`[cfx] exclude id ${id} matched nothing`);
    if (withAttachments) console.log(`[cfx] attachments: ${ctx.attachmentCount}`);

    entries.sort((a, b) => a.path.localeCompare(b.path));
    files.unshift({ name: 'index.xml', text: buildIndexXml(entries, ctx) });

    const blob = await buildZip(files, started);
    const filename = opts.filename || `${spaceKey}-${stamp(started)}.zip`;
    if (opts.download !== false && hasDom) download(blob, filename);
    console.log(`[cfx] ${files.length} files, ${(blob.size / 1024 / 1024).toFixed(1)} MB → ${filename}`);
    return { files, entries, blob, filename };
  }

  globalThis.cfx = {
    probe, run, CONFIG,
    // exposed for tests
    buildPageXml, buildIndexXml, buildZip, crc32, slug, safeFileName, listContent, listAttachments,
    detectApiBase, detectSpaceKey,
  };
  if (hasDom) console.log('[cfx] ready — await cfx.probe() or await cfx.run()');
})();
