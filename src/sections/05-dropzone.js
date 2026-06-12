// ---- ZIP intake (dependency-free, DecompressionStream-based) ----

export function isZipName(name) {
  return /\.zip$/i.test(String(name || ''));
}

/** Inflate a raw-deflate byte stream via the browser-native DecompressionStream. */
export async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {}); // errors surface via reader.read()
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

/**
 * Minimal ZIP reader (central directory; stored + deflate entries). Returns
 * [{ path, file }] where file is a blob-like { name, text(), arrayBuffer() } —
 * downstream code only needs those, and jsdom's File lacks both methods.
 */
export async function readZipEntries(zipFile) {
  const buf = new Uint8Array(await zipFile.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // End-of-central-directory record: scan backwards (trailing comment possible).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Kein gültiges ZIP-Archiv');

  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) throw new Error('ZIP-Verzeichnis beschädigt');
    const flags = view.getUint16(off + 8, true);
    const method = view.getUint16(off + 10, true);
    const csize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const path = decoder.decode(buf.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;

    if (path.endsWith('/')) continue; // directory entry
    if (flags & 0x1) throw new Error(`Verschlüsselte ZIP-Einträge werden nicht unterstützt: ${path}`);
    if (method !== 0 && method !== 8) throw new Error(`Nicht unterstützte ZIP-Kompression (${method}): ${path}`);

    // The local header repeats name/extra with possibly different lengths.
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    const bytes = method === 0 ? raw : await inflateRaw(raw);
    const name = path.split('/').pop();
    entries.push({
      path,
      file: {
        name,
        text: async () => decoder.decode(bytes),
        arrayBuffer: async () => bytes.slice().buffer,
      },
    });
  }
  return entries;
}

/** Expand ZIP archives within a flat entry list; unreadable archives are reported and skipped. */
export async function expandZipEntries(entries) {
  const out = [];
  for (const en of entries) {
    if (!isZipName(en.path)) { out.push(en); continue; }
    try {
      out.push(...(await readZipEntries(en.file)));
    } catch (e) {
      console.error('[dropzone] ZIP konnte nicht gelesen werden:', en.path, e);
      showTemporaryNotification(`ZIP-Archiv konnte nicht gelesen werden: ${en.path}`, 5000);
    }
  }
  return out;
}

// ---- Folder traversal (webkitGetAsEntry FileSystem API) ----

function readEntryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    // readEntries delivers batches (~100); loop until an empty batch arrives.
    const step = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(all); return; }
      all.push(...batch);
      step();
    }, reject);
    step();
  });
}

async function walkFsEntry(entry, prefix, out) {
  if (entry.isFile) {
    out.push({ path: prefix + entry.name, file: await readEntryFile(entry) });
  } else if (entry.isDirectory) {
    const children = await readDirectoryEntries(entry.createReader());
    for (const child of children) await walkFsEntry(child, prefix + entry.name + '/', out);
  }
}

// ---- Folder traversal (File System Access API, Chrome/Edge) ----
// Preferred over the entry API above: on file:// pages Chromium's entry API
// fails with EncodingError (it needs filesystem: URLs, which file:// origins
// cannot mint), while FileSystemHandles work there.

async function walkFsHandle(handle, prefix, out) {
  if (handle.kind === 'file') {
    out.push({ path: prefix + handle.name, file: await handle.getFile() });
  } else if (handle.kind === 'directory') {
    for await (const child of handle.values()) {
      await walkFsHandle(child, prefix + handle.name + '/', out);
    }
  }
}

async function collectViaHandle(handlePromise, out) {
  const handle = handlePromise ? await handlePromise : null;
  if (!handle) return false;
  try {
    const tmp = [];
    await walkFsHandle(handle, '', tmp);
    out.push(...tmp);
    return true;
  } catch (e) {
    console.warn('[dropzone] FileSystemHandle-Traversierung fehlgeschlagen:', e);
    return false;
  }
}

async function collectViaEntry(entry, out) {
  try {
    const tmp = [];
    await walkFsEntry(entry, '', tmp);
    out.push(...tmp);
    return true;
  } catch (e) {
    console.warn('[dropzone] FileSystem-Entry-Traversierung fehlgeschlagen:', e);
    return false;
  }
}

/**
 * Turn a drop's DataTransfer into flat [{path, file}] entries: folders are
 * walked recursively, ZIP archives unpacked. Must be CALLED SYNCHRONOUSLY
 * from the drop handler — getAsFileSystemHandle()/webkitGetAsEntry()/
 * getAsFile() only work while the event is live; all handles are
 * materialized before the first await.
 */
export async function collectDropPayload(dataTransfer) {
  const handles = [];
  const items = dataTransfer && dataTransfer.items;
  if (items && items.length) {
    for (const item of Array.from(items)) {
      const handlePromise = typeof item.getAsFileSystemHandle === 'function'
        ? item.getAsFileSystemHandle().catch(() => null)
        : null;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      const file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
      if (handlePromise || entry || file) handles.push({ handlePromise, entry, file });
    }
  } else {
    for (const file of Array.from((dataTransfer && dataTransfer.files) || [])) {
      if (file) handles.push({ handlePromise: null, entry: null, file });
    }
  }

  const flat = [];
  for (const h of handles) {
    if (await collectViaHandle(h.handlePromise, flat)) continue;
    if (h.entry && h.entry.isDirectory) {
      if (await collectViaEntry(h.entry, flat)) continue;
      showTemporaryNotification(`Ordner "${h.entry.name}" konnte nicht gelesen werden – bitte als ZIP-Archiv packen und droppen.`, 6000);
      continue;
    }
    // Plain file: prefer the File from getAsFile — entry.file() breaks on file:// pages.
    if (h.file) { flat.push({ path: h.file.name, file: h.file }); continue; }
    if (h.entry && h.entry.isFile && (await collectViaEntry(h.entry, flat))) continue;
  }
  return expandZipEntries(flat);
}

export function ensureOverlay(onFiles) {
  if (_overlay) return _overlay;

  const overlay = document.createElement('div');
  overlay.className = 'dz-overlay';
  overlay.innerHTML = `
    <div class="dz-panel">
      <div class="dz-icon">⬇</div>
      <h2 class="dz-title">Daten hierher ziehen</h2>
      <p class="dz-text">
        JSON-Datensatz, optional <code>pseudo.data.json</code>, <code>env.json</code>
        und Attribut-Dateien (<code>.tsv</code>/<code>.csv</code>/<code>.txt</code>).<br>
        Auch möglich: ein ganzer Ordner oder ein ZIP-Archiv mit <code>env.json</code> —
        die darin referenzierten Dateien werden automatisch mitgeladen.<br>
        Die Inhalte werden lokal im Browser (IndexedDB) gespeichert und beim
        nächsten Öffnen automatisch geladen.
      </p>
      <button class="dz-pick" type="button">Dateien auswählen…</button>
    </div>`;

  const pick = overlay.querySelector('.dz-pick');
  pick.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = '.json,.tsv,.csv,.txt,.zip,application/json,application/zip';
    picker.style.display = 'none';
    document.body.appendChild(picker);
    picker.addEventListener('change', () => {
      const files = Array.from(picker.files || []);
      picker.remove();
      if (!files.length) return;
      expandZipEntries(files.map((f) => ({ path: f.name, file: f }))).then((entries) => {
        if (entries.length) onFiles(entries);
      });
    });
    picker.click();
  });

  document.body.appendChild(overlay);
  _overlay = overlay;
  return overlay;
}

export function showDropZone(onFiles) {
  ensureOverlay(onFiles).classList.add('dz-visible');
}

export function hideDropZone() {
  if (_overlay) _overlay.classList.remove('dz-visible');
}

/**
 * Install window-wide drag&drop so files, folders or ZIP archives can be
 * dropped any time to (re)load. onFiles receives flat [{path, file}] entries.
 */
export function installGlobalDrop(onFiles) {
  const onDragEnter = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    _dragDepth++;
    document.body.classList.add('dz-dragging');
  };
  const onDragOver = (e) => {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e) => {
    e.preventDefault();
    _dragDepth = Math.max(0, _dragDepth - 1);
    if (_dragDepth === 0) document.body.classList.remove('dz-dragging');
  };
  const onDrop = (e) => {
    e.preventDefault();
    _dragDepth = 0;
    document.body.classList.remove('dz-dragging');
    if (!e.dataTransfer) return;
    // collectDropPayload materializes the entry handles synchronously here.
    collectDropPayload(e.dataTransfer)
      .then((entries) => {
        if (entries.length) onFiles(entries);
      })
      .catch((err) => {
        console.error('[dropzone] Drop konnte nicht verarbeitet werden:', err);
        showTemporaryNotification('Drop konnte nicht verarbeitet werden – Ordner ggf. als ZIP-Archiv droppen.', 6000);
      });
  };

  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('drop', onDrop);
}


// ===== src/app.js =====

let raw = { nodes: [], links: [], persons: [], orgs: []};
let personAttributes = new Map(); // Map von ID/Email zu Attribut-Maps
let attributeTypes = new Map(); // Map von Attributnamen zu Farbwerten
let activeAttributes = new Set(); // Menge der aktiven Attribute für die Anzeige
let emptyCategories = new Set(); // Kategorien ohne Attribute (nur Platzhalter)
let categorySourceFiles = new Map(); // Map Kategorie -> {filename, url, originalData}
let modifiedCategories = new Set(); // Set von Kategorien mit Änderungen
let byId = new Map();
let allNodesUnique = [];
let attributesVisible = true; // Flag für die Sichtbarkeit der Attribute
let savedActiveAttributes = new Set(); // Speicher für aktive Attribute
let filteredItems = [];
let activeIndex = -1;
let currentSelectedId = null;
let searchDebounceTimer = null;
let zoomBehavior = null;
let managementEnabled = true;
let clusterLayer = null;
let clusterSimById = new Map();
let clusterPersonIds = new Set();
let clusterPolygons = new Map();
let currentZoomTransform = null;
let labelsVisible = 'all'; // 'all' | 'attributes' | 'none' - Label-Sichtbarkeitsmodus
let debugMode = false;
let continuousSimulation = false; // Kontinuierliche Animation aktiviert
let legendMenuEl = null;
let nodeMenuEl = null;
let simAllById = new Map();
let parentOf = new Map();
let orgParent = new Map();      // childOrgId -> parentOrgId
let orgChildren = new Map();    // parentOrgId -> Set(childOrgId)
let orgRoots = [];              // Array der Wurzel-OEs (ohne Eltern)
let orgLegendNodes = new Map();
let currentSubgraph = null;
let currentLayoutMode = 'force'; // 'force' or 'hierarchy'
let hierarchyLevels = new Map(); // nodeId -> level number
let currentSimulation = null; // Global reference to D3 simulation
let preferredData = "auto";
let envConfig = null;
let collapsedCategories = new Set(); // Kategorien mit eingeklapptem Zustand
let hiddenCategories = new Set();    // Kategorien die temporär ausgeblendet sind (ohne Attribut-Status zu ändern)
let hiddenNodes = new Set();
let hiddenByRoot = new Map();
let temporarilyVisibleRoots = new Set(); // Roots deren Hidden-Subtrees temporär sichtbar sind
let allHiddenTemporarilyVisible = false; // Globaler Toggle für alle Hidden-Subtrees
let currentHiddenCount = 0; // Anzahl der ausgeblendeten Knoten in der aktuellen Ansicht
let selectedRootIds = [];
let lastSingleRootId = null;
let lastRenderRoots = [];
let lastRenderDepth = null;
let lastRenderDirMode = 'both';

// Pseudonymisierung [SF]
let pseudonymizationEnabled = true;
let pseudoData = null; // { names: [], organizationalUnits0: [], organizationalUnits1: [], ... }
let pseudoNameMapping = new Map();   // originalName -> pseudoName
let pseudoOrgMapping = new Map();    // originalOrgLabel -> pseudoOrgLabel
let pseudoNameIndex = 0;
let pseudoOrgIndices = new Map();    // level -> currentIndex

export const Logger = {
  ts() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${h}:${m}:${s}.${ms}`;
  },
  log(msg, data) {
    if (!debugMode) return;
    const prefix = `[${this.ts()}]${msg}`;
    if (data !== undefined) {
      console.log(prefix, data);
    } else {
      console.log(prefix);
    }
  }
};

// ========== Pseudonymisierung Funktionen [SF][DRY] ==========

/**
 * Lädt die Pseudonymisierungs-Daten aus der fixen URL
 */
