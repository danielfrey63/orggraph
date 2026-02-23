export class GraphStore {
  static #instance = null;

  static getInstance() {
    if (!GraphStore.#instance) {
      GraphStore.#instance = new GraphStore();
      console.log('[GraphStore] New Instance created');
    } else {
        console.log('[GraphStore] Returning existing instance');
    }
    return GraphStore.#instance;
  }

  constructor() {
    if (GraphStore.#instance) {
      return GraphStore.#instance;
    }
    console.log('[GraphStore] Constructor called');

    this.state = {
      // Daten
      raw: { nodes: [], links: [], persons: [], orgs: [] },
      byId: new Map(),
      byEmail: new Map(), // email -> personId [PA]
      allNodesUnique: [],

      // Attribute
      personAttributes: new Map(),
      personToOrgs: new Map(), // personId -> Set<orgId> [PA]
      attributeTypes: new Map(),
      activeAttributes: new Set(),
      emptyCategories: new Set(),
      hiddenCategories: new Set(),
      categorySourceFiles: new Map(),
      modifiedCategories: new Set(),
      categoryPalettes: new Map(),
      attributesVisible: true,
      labelsVisible: 'all', // 'all' | 'attributes' | 'none'
      collapsedCategories: new Set(),

      // Auswahl & Filter
      selectedRootIds: [],
      lastSingleRootId: null,
      currentSelectedId: null,
      allowedOrgs: new Set(),
      hiddenNodes: new Set(),
      hiddenByRoot: new Map(),
      temporarilyVisibleRoots: new Set(),
      allHiddenTemporarilyVisible: false,
      currentHiddenCount: 0,

      // Konfiguration
      pseudonymizationEnabled: true,
      debugMode: false,
      managementEnabled: true,
      currentLayoutMode: 'force', // 'force' or 'hierarchy'
      envConfig: null,
    };

    this.listeners = new Set();

    GraphStore.#instance = this;
  }

  // --- Listener / Events -------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(event, payload) {
    for (const fn of this.listeners) {
      try {
        fn({ event, payload, state: this.state });
      } catch (e) {
        // Listener-Fehler nicht propagieren
        console.error('[GraphStore] Listener error', e);
      }
    }
  }

  // --- Getter ------------------------------------------------------------

  getRaw() {
    return this.state.raw;
  }

  // --- Mutations: Daten --------------------------------------------------

  setRawData(raw) {
    console.log('[GraphStore] setRawData called with:', raw ? { nodes: raw.nodes?.length, links: raw.links?.length } : 'null');
    this.state.raw = raw || { nodes: [], links: [], persons: [], orgs: [] };
    this.notify('raw:update', this.state.raw);
  }

  setById(map) {
    this.state.byId = map || new Map();
    this.notify('byId:update', this.state.byId);
  }

  setByEmail(map) {
    this.state.byEmail = map || new Map();
    this.notify('byEmail:update', this.state.byEmail);
  }

  setPersonToOrgs(map) {
    this.state.personToOrgs = map || new Map();
    this.notify('personToOrgs:update', this.state.personToOrgs);
  }

  setAllNodesUnique(nodes) {
    this.state.allNodesUnique = Array.isArray(nodes) ? nodes : [];
    this.notify('allNodesUnique:update', this.state.allNodesUnique);
  }

  setHierarchy({ parentOf, orgParent, orgChildren, orgRoots }) {
    if (parentOf) this.state.parentOf = parentOf;
    if (orgParent) this.state.orgParent = orgParent;
    if (orgChildren) this.state.orgChildren = orgChildren;
    if (orgRoots) this.state.orgRoots = orgRoots;
    this.notify('hierarchy:update', { 
      parentOf: this.state.parentOf, 
      orgParent: this.state.orgParent, 
      orgChildren: this.state.orgChildren, 
      orgRoots: this.state.orgRoots 
    });
  }

  // --- Mutations: Attribute ---------------------------------------------

  setPersonAttributes(map) {
    this.state.personAttributes = map || new Map();
    this.notify('personAttributes:update', this.state.personAttributes);
  }

  setAttributeTypes(map) {
    this.state.attributeTypes = map || new Map();
    this.notify('attributeTypes:update', this.state.attributeTypes);
  }

  setActiveAttributes(set) {
    this.state.activeAttributes = set || new Set();
    this.notify('activeAttributes:update', this.state.activeAttributes);
  }

  toggleAttribute(key) {
    const s = this.state.activeAttributes;
    if (s.has(key)) {
      s.delete(key);
    } else {
      s.add(key);
    }
    this.notify('activeAttributes:toggle', { key, activeAttributes: s });
  }

  setHiddenCategories(set) {
    this.state.hiddenCategories = set || new Set();
    this.notify('hiddenCategories:update', this.state.hiddenCategories);
  }

  setEmptyCategories(set) {
    this.state.emptyCategories = set || new Set();
    this.notify('emptyCategories:update', this.state.emptyCategories);
  }

  setCategorySourceFiles(map) {
    this.state.categorySourceFiles = map || new Map();
    this.notify('categorySourceFiles:update', this.state.categorySourceFiles);
  }

  setModifiedCategories(set) {
    this.state.modifiedCategories = set || new Set();
    this.notify('modifiedCategories:update', this.state.modifiedCategories);
  }

  setAttributesVisible(visible) {
    this.state.attributesVisible = !!visible;
    this.notify('attributesVisible:update', this.state.attributesVisible);
  }

  setLabelsVisible(mode) {
    this.state.labelsVisible = mode;
    this.notify('labelsVisible:update', this.state.labelsVisible);
  }

  setCollapsedCategories(set) {
    this.state.collapsedCategories = set || new Set();
    this.notify('collapsedCategories:update', this.state.collapsedCategories);
  }

  setCategoryPalettes(map) {
    this.state.categoryPalettes = map || new Map();
    this.notify('categoryPalettes:update', this.state.categoryPalettes);
  }

  // --- Mutations: Auswahl & Filter --------------------------------------

  setSelectedRootIds(ids) {
    this.state.selectedRootIds = Array.isArray(ids) ? ids.map(String) : [];
    this.notify('selectedRootIds:update', this.state.selectedRootIds);
  }

  setLastSingleRootId(id) {
    this.state.lastSingleRootId = id != null ? String(id) : null;
    this.notify('lastSingleRootId:update', this.state.lastSingleRootId);
  }

  addRoot(id) {
    const s = String(id);
    if (!this.state.selectedRootIds.includes(s)) {
      this.state.selectedRootIds = this.state.selectedRootIds.concat([s]);
      this.notify('selectedRootIds:add', this.state.selectedRootIds);
    }
  }

  removeRoot(id) {
    const s = String(id);
    this.state.selectedRootIds = this.state.selectedRootIds.filter(x => x !== s);
    this.notify('selectedRootIds:remove', this.state.selectedRootIds);
  }

  setSingleRoot(id) {
    this.state.selectedRootIds = [String(id)];
    this.state.currentSelectedId = String(id);
    this.notify('selectedRootIds:single', {
      selectedRootIds: this.state.selectedRootIds,
      currentSelectedId: this.state.currentSelectedId,
    });
  }

  setCurrentSelectedId(id) {
    this.state.currentSelectedId = id != null ? String(id) : null;
    this.notify('currentSelectedId:update', this.state.currentSelectedId);
  }

  setAllowedOrgs(set) {
    this.state.allowedOrgs = set || new Set();
    this.notify('allowedOrgs:update', this.state.allowedOrgs);
  }

  setHiddenNodes(set) {
    this.state.hiddenNodes = set || new Set();
    this.notify('hiddenNodes:update', this.state.hiddenNodes);
  }

  setHiddenByRoot(map) {
    this.state.hiddenByRoot = map || new Map();
    this.notify('hiddenByRoot:update', this.state.hiddenByRoot);
  }

  setTemporarilyVisibleRoots(set) {
    this.state.temporarilyVisibleRoots = set || new Set();
    this.notify('temporarilyVisibleRoots:update', this.state.temporarilyVisibleRoots);
  }

  setAllHiddenTemporarilyVisible(visible) {
    this.state.allHiddenTemporarilyVisible = !!visible;
    this.notify('allHiddenTemporarilyVisible:update', this.state.allHiddenTemporarilyVisible);
  }

  setCurrentHiddenCount(count) {
    this.state.currentHiddenCount = count || 0;
    this.notify('currentHiddenCount:update', this.state.currentHiddenCount);
  }

  // --- Mutations: Konfiguration -----------------------------------------

  setManagementEnabled(enabled) {
    this.state.managementEnabled = !!enabled;
    this.notify('managementEnabled:update', this.state.managementEnabled);
  }

  setCurrentLayoutMode(mode) {
    this.state.currentLayoutMode = mode;
    this.notify('currentLayoutMode:update', this.state.currentLayoutMode);
  }

  setEnvConfig(config) {
    this.state.envConfig = config || {};
    this.notify('envConfig:update', this.state.envConfig);
  }

  setPseudonymizationEnabled(enabled) {
    this.state.pseudonymizationEnabled = !!enabled;
    this.notify('pseudonymization:update', this.state.pseudonymizationEnabled);
  }

  setDebugMode(enabled) {
    this.state.debugMode = !!enabled;
    this.notify('debugMode:update', this.state.debugMode);
  }
}

export const graphStore = GraphStore.getInstance();
