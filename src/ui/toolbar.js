import { INPUT_DEPTH_ID } from '../constants.js';
import { graphStore } from '../state/store.js';
import { showPasswordDialog } from './dialogs.js';

export class ToolbarUI {
  constructor(renderer) {
    this.renderer = renderer;
    this.depthInput = document.querySelector(INPUT_DEPTH_ID);
    this.unsubscribe = graphStore.subscribe(this.handleStoreUpdate.bind(this));
  }

  init() {
    this.initDepthControl();
    this.initDirectionToggle();
    this.initToggles();
    this.initFitButton();
    this.initDebugButton();
    
    // Set initial state from store
    this.updateUIFromStore(graphStore.state);
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
  }

  handleStoreUpdate({ state }) {
    this.updateUIFromStore(state);
  }

  updateUIFromStore(state) {
    // Update toggle buttons state based on store
    this.setButtonActive('toggleManagement', state.managementEnabled);
    this.setButtonActive('toggleHierarchy', state.currentLayoutMode === 'hierarchy');
    this.setButtonActive('toggleLabels', state.labelsVisible !== 'none');
    this.setButtonActive('togglePseudonymization', state.pseudonymizationEnabled);
    this.setButtonActive('debugBtn', state.debugMode);
  }

  setButtonActive(id, active) {
    const btn = document.getElementById(id);
    if (btn) {
      if (active) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  }

  initDepthControl() {
    const control = document.getElementById('depthControl');
    if (!control || !this.depthInput) return;

    const display = control.querySelector('.depth-value');
    const upBtn = control.querySelector('.depth-up');
    const downBtn = control.querySelector('.depth-down');

    const updateDisplay = () => {
      if (display) display.textContent = this.depthInput.value;
    };

    if (upBtn) {
      upBtn.addEventListener('click', () => {
        this.depthInput.stepUp();
        this.depthInput.dispatchEvent(new Event('change'));
        updateDisplay();
      });
    }

    if (downBtn) {
      downBtn.addEventListener('click', () => {
        this.depthInput.stepDown();
        this.depthInput.dispatchEvent(new Event('change'));
        updateDisplay();
      });
    }

    // Initial display
    updateDisplay();
    
    // Listen to input changes (if changed from elsewhere)
    this.depthInput.addEventListener('change', updateDisplay);
  }

  initDirectionToggle() {
    const container = document.getElementById('directionToggle');
    if (!container) return;

    const upBtn = container.querySelector('.direction-up');
    const downBtn = container.querySelector('.direction-down');

    const updateState = (dir) => {
      // dir: 'up', 'down', 'both'
      if (upBtn) upBtn.classList.toggle('active', dir === 'up' || dir === 'both');
      if (downBtn) downBtn.classList.toggle('active', dir === 'down' || dir === 'both');
      
      graphStore.notify('direction:update', dir);
    };

    if (upBtn) {
      upBtn.addEventListener('click', () => {
        const isUp = upBtn.classList.contains('active');
        const isDown = downBtn.classList.contains('active');
        
        let nextUp = !isUp; 
        let nextDown = isDown;
        
        if (!nextUp && !nextDown) nextUp = true; // Prevent none
        
        updateState(nextUp && nextDown ? 'both' : (nextUp ? 'up' : 'down'));
        this.triggerRender();
      });
    }

    if (downBtn) {
      downBtn.addEventListener('click', () => {
        const isUp = upBtn.classList.contains('active');
        const isDown = downBtn.classList.contains('active');
        
        let nextUp = isUp;
        let nextDown = !isDown;
        
        if (!nextUp && !nextDown) nextDown = true; // Prevent none
        
        updateState(nextUp && nextDown ? 'both' : (nextUp ? 'up' : 'down'));
        this.triggerRender();
      });
    }
  }
  
  getDirection() {
    const container = document.getElementById('directionToggle');
    if (!container) return 'both';
    const up = container.querySelector('.direction-up')?.classList.contains('active');
    const down = container.querySelector('.direction-down')?.classList.contains('active');
    if (up && down) return 'both';
    if (up) return 'up';
    if (down) return 'down';
    return 'both';
  }

  initToggles() {
    // Management
    const mgmtBtn = document.getElementById('toggleManagement');
    if (mgmtBtn) {
      mgmtBtn.addEventListener('click', () => {
        graphStore.setManagementEnabled(!graphStore.state.managementEnabled);
      });
    }

    // Hierarchy
    const hierBtn = document.getElementById('toggleHierarchy');
    if (hierBtn) {
      hierBtn.addEventListener('click', () => {
        const mode = graphStore.state.currentLayoutMode === 'hierarchy' ? 'force' : 'hierarchy';
        graphStore.setCurrentLayoutMode(mode);
        
        // Apply to renderer
        if (this.renderer) {
            // Renderer needs to handle layout switch
            // Currently renderer seems to use force layout by default
            // We might need to implement switch in renderer
            // For now, just update store
        }
      });
    }

    // Labels
    const labelsBtn = document.getElementById('toggleLabels');
    if (labelsBtn) {
      labelsBtn.addEventListener('click', () => {
        // Toggle logic: all -> none -> all (or attributes?)
        // Simple toggle for now
        const current = graphStore.state.labelsVisible;
        const next = current === 'none' ? 'all' : 'none';
        graphStore.setLabelsVisible(next);
      });
    }

    // Simulation
    const simBtn = document.getElementById('toggleSimulation');
    if (simBtn) {
      simBtn.addEventListener('click', () => {
        simBtn.classList.toggle('active');
        const active = simBtn.classList.contains('active');
        if (this.renderer) {
          this.renderer.setContinuousSimulation(active);
          if (active) this.renderer.restartSimulation();
        }
      });
    }

    // Pseudonymization
    const pseudoBtn = document.getElementById('togglePseudonymization');
    if (pseudoBtn) {
      pseudoBtn.addEventListener('click', () => {
        const enabled = graphStore.state.pseudonymizationEnabled;
        if (enabled) {
          // Disable requires password
          showPasswordDialog((pw) => {
            const configPw = graphStore.state.envConfig?.TOOLBAR_PSEUDO_PASSWORD || '';
            if (pw === configPw) {
              graphStore.setPseudonymizationEnabled(false);
              return true;
            }
            return false;
          });
        } else {
          // Enable directly
          graphStore.setPseudonymizationEnabled(true);
        }
      });
    }
  }

  initFitButton() {
    const fitBtn = document.getElementById('fit');
    if (fitBtn && this.renderer) {
      fitBtn.addEventListener('click', () => {
        if (this.renderer.fitToViewport) {
            this.renderer.fitToViewport();
        } else {
            // Fallback reset zoom
            this.renderer.zoomTo(1); 
        }
      });
    }
  }

  initDebugButton() {
    const debugBtn = document.getElementById('debugBtn');
    if (debugBtn) {
      debugBtn.addEventListener('click', () => {
        graphStore.setDebugMode(!graphStore.state.debugMode);
      });
    }
  }

  triggerRender() {
    // Trigger render in app.js via event or direct call?
    // app.js setupEventListeners listened to 'change' on depth input.
    // Here we can dispatch a custom event or rely on store updates.
    // For direction, we don't have store update yet.
    // Let's dispatch 'graph:render-request'
    window.dispatchEvent(new CustomEvent('graph:render-request'));
  }
}
