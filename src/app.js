import { SVG_ID, INPUT_DEPTH_ID } from './constants.js';
import './style.css';

// Services & Store
import { graphStore } from './state/store.js';
import { loadData, loadAttributesFromFile } from './data/loader.js';
import { loadEnvConfig } from './config/env.js';
import { computeSubgraph } from './graph/subgraph.js';
import { pseudonymizationService } from './services/pseudonymization.js';

// Components
import { GraphRenderer } from './graph/renderer.js';
import { SearchUI } from './ui/search.js';
import { LegendUI } from './ui/legend.js';
import { DebugUI } from './ui/debug.js';
import { ToolbarUI } from './ui/toolbar.js';
import { detailPanel } from './ui/detail-panel.js';
import { showNodeContextMenu as showNodeMenu } from './ui/node-menu.js';
import { initializeExport } from './ui/export.js';
import { VisibilityManager } from './graph/visibility.js';
import { setStatus } from './utils/dom.js';
import { Logger } from './utils/logger.js';

/**
 * Main Application Controller
 */
class App {
  constructor() {
    this.renderer = null;
    this.searchUI = null;
    this.legendUI = null;
    this.debugUI = null;
    this.toolbarUI = null;
    this.visibilityManager = null;
    this.currentTransitionId = 0;
  }

  async init() {
    // 1. Load Config
    await loadEnvConfig();
    await pseudonymizationService.loadPseudoData();

    // Apply Config to Store
    const config = graphStore.state.envConfig;
    if (config) {
      if (config.TOOLBAR_MANAGEMENT_ACTIVE !== undefined) {
        graphStore.setManagementEnabled(config.TOOLBAR_MANAGEMENT_ACTIVE);
      }
      if (config.TOOLBAR_HIERARCHY_ACTIVE !== undefined) {
        graphStore.setCurrentLayoutMode(config.TOOLBAR_HIERARCHY_ACTIVE ? 'hierarchy' : 'force');
      }
      if (config.TOOLBAR_LABELS_ACTIVE !== undefined) {
        // Handle boolean legacy (true='all', false='none') or string mode
        let labelMode = config.TOOLBAR_LABELS_ACTIVE;
        if (labelMode === true) labelMode = 'all';
        if (labelMode === false) labelMode = 'none';
        graphStore.setLabelsVisible(labelMode);
      }
      if (config.TOOLBAR_PSEUDO_ACTIVE !== undefined) {
        graphStore.setPseudonymizationEnabled(config.TOOLBAR_PSEUDO_ACTIVE);
      }
      if (config.TOOLBAR_DEBUG_ACTIVE !== undefined) {
        const debug = !!config.TOOLBAR_DEBUG_ACTIVE;
        graphStore.setDebugMode(debug);
        Logger.setDebugMode(debug); // Sync Logger immediately
      }
      if (config.LEGEND_ATTRIBUTES_ACTIVE !== undefined) {
        graphStore.setAttributesVisible(config.LEGEND_ATTRIBUTES_ACTIVE);
      }
      // Apply depth default to hidden input [SF]
      if (config.TOOLBAR_DEPTH_DEFAULT !== undefined) {
        const depthInput = document.querySelector(INPUT_DEPTH_ID);
        if (depthInput) {
          depthInput.value = config.TOOLBAR_DEPTH_DEFAULT;
        }
      }
    }

    // 2. Initialize Components
    this.renderer = new GraphRenderer({
      svgSelector: SVG_ID,
      onNodeClick: this.handleNodeClick.bind(this)
    });
    
    this.searchUI = new SearchUI(this.handleSearchUpdate.bind(this));
    this.searchUI.init();
    
    this.legendUI = new LegendUI();
    this.legendUI.init();
    
    this.debugUI = new DebugUI(this.renderer);
    this.debugUI.init();
    
    this.toolbarUI = new ToolbarUI(this.renderer);
    this.toolbarUI.init();
    
    this.visibilityManager = new VisibilityManager();
    
    initializeExport();
    
    // 3. Setup UI Event Listeners (Global/Orchestration)
    this.setupEventListeners();
    
    // 4. Subscribe to Store
    graphStore.subscribe(this.handleStoreUpdate.bind(this));
    
    // 5. Load Data
    const dataLoaded = await loadData();
    if (dataLoaded) {
      // Setup initial view
      const startId = graphStore.state.envConfig?.GRAPH_START_ID_DEFAULT || '';
      // If we have a start ID, set it. Otherwise, populate list or wait for user.
      if (startId) {
        graphStore.setSingleRoot(startId);
      } else {
        // Render full or empty?
        // Let's render whatever we can or just initial state
        this.render();
      }
    }
  }

  setupEventListeners() {
    // Listen for render request from Toolbar (e.g. direction change, depth)
    window.addEventListener('graph:render-request', () => this.render());
    
    // Depth Input - ToolbarUI handles the value change, we just need to re-render
    // ToolbarUI dispatches 'change' event on input, and we can listen or use render-request
    const depthInput = document.querySelector(INPUT_DEPTH_ID);
    if (depthInput) {
      depthInput.addEventListener('change', () => this.render());
    }
    
    // Global Hidden Toggle (handled in LegendUI/VisibilityManager but triggered via UI)
    // Listen for custom events dispatched by UI components
    window.addEventListener('graph:unhide-subtree', (e) => {
      if (this.visibilityManager) this.visibilityManager.toggleVisibility(e.detail.rootId);
    });
    window.addEventListener('graph:toggle-temp-visibility', (e) => {
      if (this.visibilityManager) this.visibilityManager.toggleTemporaryVisibility(e.detail.rootId);
    });
    
    // Drag & Drop
    document.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (e.dataTransfer.files?.length) {
        await loadAttributesFromFile(e.dataTransfer.files[0]);
      }
    });
    
    // SVG Context Menu
    const svgEl = document.querySelector(SVG_ID);
    if (svgEl) {
        svgEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // Check if clicked on background (not node)
            if (e.target.tagName === 'svg' || e.target.classList.contains('zoom-layer')) {
                // Show global context menu if needed?
            }
        });
        
        svgEl.addEventListener('mouseover', (e) => {
            const nodeG = e.target.closest('.node');
            if (nodeG && nodeG.__data__) {
                const d = nodeG.__data__;
                detailPanel.show(d, e);
                if (this.renderer) this.renderer.hoverDetailNode = d;
            }
        });
        
        svgEl.addEventListener('mouseout', (e) => {
            const nodeG = e.target.closest('.node');
            if (nodeG) {
                detailPanel.hide();
                if (this.renderer) this.renderer.hoverDetailNode = null;
            }
        });
        
        // Context menu on nodes
        svgEl.addEventListener('contextmenu', (e) => {
            const nodeG = e.target.closest('.node');
            if (nodeG && nodeG.__data__) {
                e.preventDefault();
                e.stopPropagation();
                const d = nodeG.__data__;
                const { selectedRootIds } = graphStore.state;
                const isRoot = selectedRootIds.includes(String(d.id));
                
                showNodeMenu(e.clientX, e.clientY, {
                    nodeId: d.id,
                    isRoot,
                    onHideSubtree: () => {
                        this.visibilityManager.toggleVisibility(d.id);
                    },
                    onSetAsRoot: () => {
                        graphStore.addRoot(d.id);
                    },
                    onRemoveRoot: () => {
                        graphStore.removeRoot(d.id);
                    }
                });
            }
        });
    }
  }

  handleStoreUpdate({ event, state }) {
    if (event.startsWith('selectedRootIds:') || event === 'currentSelectedId:update') {
      this.render();
    }
    if (event === 'currentSelectedId:update') {
        // SearchUI updates itself via store subscription
        // Renderer highlight
        if (this.renderer && state.currentSelectedId) {
            this.renderer.highlight([state.currentSelectedId]);
        }
    }
    if (event === 'hiddenNodes:update') {
        this.render();
    }
    
    // Visual updates that don't require full re-render
    if (
        event === 'pseudonymization:update' ||
        event === 'labelsVisible:update' ||
        event === 'activeAttributes:update' ||
        event === 'attributeTypes:update' ||
        event === 'hiddenCategories:update' ||
        event === 'attributesVisible:update' ||
        event === 'debugMode:update'
    ) {
        if (event === 'debugMode:update') {
            // Synchronize Logger with Store
            Logger.setDebugMode(state.debugMode);
            Logger.log('Debug Mode synced:', state.debugMode);
        }

        if (this.renderer) {
            this.renderer.updateVisualParams();
        }
    }
    
    if (event === 'currentLayoutMode:update') {
        if (this.renderer) {
            this.renderer.updateLayout();
        }
    }
  }

  handleNodeClick(d) {
    // Single click logic: select node
    graphStore.setCurrentSelectedId(d.id);
    
    // If Shift key held? (handled in renderer? no, renderer passes raw click)
    // Renderer 'onNodeClick' gets (d). To detect shift, we need event.
    // Assuming simple selection for now.
    
    // Also log to console
    Logger.log('Node clicked:', d);
  }

  handleSearchUpdate(action) {
    if (action === 'comboSelect') {
      this.render();
    }
  }

  render() {
    const { selectedRootIds, currentSelectedId } = graphStore.state;
    
    // Determine roots
    let roots = [];
    if (selectedRootIds.length > 0) roots = selectedRootIds;
    else if (currentSelectedId) roots = [currentSelectedId];
    
    if (roots.length === 0) {
        setStatus('Bitte eine Person oder OE wählen');
        return;
    }
    
    // Determine depth and mode
    const depthInput = document.querySelector(INPUT_DEPTH_ID);
    const depth = parseInt(depthInput?.value || '2', 10);
    const mode = this.toolbarUI ? this.toolbarUI.getDirection() : 'both';
    
    // Compute Subgraph
    // We can compute union of subgraphs for multiple roots
    // For now, simpler: compute for first root or merge?
    // If multi-root, we need to merge results.
    
    let allNodes = new Map();
    let allLinks = new Map();
    let allLegendOrgs = new Set();
    
    roots.forEach(rootId => {
        const sub = computeSubgraph(rootId, depth, mode);
        sub.nodes.forEach(n => allNodes.set(String(n.id), n));
        sub.links.forEach(l => {
            const key = `${l.source}|${l.target}`;
            allLinks.set(key, l);
        });
        if (sub.legendOrgs) {
            sub.legendOrgs.forEach(oid => allLegendOrgs.add(oid));
        }
    });
    
    // Scope allowedOrgs to subgraph OEs + their ancestor chain [SF]
    const { parentOf } = graphStore.state;
    const scopedOrgs = new Set(allLegendOrgs);
    for (const oid of allLegendOrgs) {
        let cur = parentOf?.get(oid);
        while (cur && !scopedOrgs.has(cur)) {
            scopedOrgs.add(cur);
            cur = parentOf.get(cur);
        }
    }
    graphStore.setAllowedOrgs(scopedOrgs);
    
    const subgraph = {
        nodes: Array.from(allNodes.values()),
        links: Array.from(allLinks.values())
    };
    
    // Transition
    this.currentTransitionId++;
    const transitionId = this.currentTransitionId;
    
    if (this.currentSubgraph) {
        this.renderer.transition(this.currentSubgraph, subgraph, roots, transitionId).then(() => {
            if (this.currentTransitionId !== transitionId) return;
            // Update stats
            this.updateStats(subgraph);
            this.updateDetailPanel();
        });
    } else {
        this.renderer.update(subgraph);
        this.updateStats(subgraph);
        this.updateDetailPanel();
    }
    
    this.currentSubgraph = subgraph;
  }
  
  updateDetailPanel() {
      const { allowedOrgs, parentOf } = graphStore.state;
      detailPanel.updateState({
          clusterPolygons: this.renderer.clusterPolygons,
          allowedOrgs,
          parentOf
      });
  }
  
  updateStats(subgraph) {
      const { raw, activeAttributes, attributeTypes, allowedOrgs } = graphStore.state;
      // Basic stats
      document.getElementById('stats-nodes-total').textContent = raw.nodes.length;
      document.getElementById('stats-links-total').textContent = raw.links.length;
      document.getElementById('stats-nodes-visible').textContent = subgraph.nodes.length;
      document.getElementById('stats-links-visible').textContent = subgraph.links.length;
      
      // Attr stats
      const attrEl = document.getElementById('stats-attributes-count');
      if (attrEl) attrEl.textContent = `${activeAttributes.size}/${attributeTypes.size}`;
      
      // Org stats
      const orgsCountEl = document.getElementById('stats-orgs-count');
      if (orgsCountEl) orgsCountEl.textContent = allowedOrgs.size;
  }
}

const app = new App();
app.init();
