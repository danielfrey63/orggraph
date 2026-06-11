function ensureOverlay(onFiles) {
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
        Mehrere Dateien gleichzeitig sind möglich. Die Inhalte werden lokal im Browser
        (IndexedDB) gespeichert und beim nächsten Öffnen automatisch geladen.
      </p>
      <button class="dz-pick" type="button">Dateien auswählen…</button>
    </div>`;

  const pick = overlay.querySelector('.dz-pick');
  pick.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.accept = '.json,.tsv,.csv,.txt,application/json';
    picker.style.display = 'none';
    document.body.appendChild(picker);
    picker.addEventListener('change', () => {
      const files = picker.files;
      picker.remove();
      if (files && files.length) onFiles(files);
    });
    picker.click();
  });

  document.body.appendChild(overlay);
  _overlay = overlay;
  return overlay;
}

function showDropZone(onFiles) {
  ensureOverlay(onFiles).classList.add('dz-visible');
}

function hideDropZone() {
  if (_overlay) _overlay.classList.remove('dz-visible');
}

/**
 * Install window-wide drag&drop so files can be dropped any time to (re)load.
 * onFiles receives a FileList.
 */
function installGlobalDrop(onFiles) {
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
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) onFiles(files);
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

const Logger = {
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
