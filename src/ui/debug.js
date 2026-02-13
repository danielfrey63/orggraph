import { setGraphParam, getGraphParam, resetGraphParams } from '../utils/css.js';
import { graphStore } from '../state/store.js';

export class DebugUI {
  constructor(renderer) {
    this.renderer = renderer;
    this.container = null;
    this.isVisible = false;
  }

  init() {
    this.container = document.getElementById('debugForceToolbar');
    if (!this.container) return;

    // Listen for debug mode changes
    graphStore.subscribe(({ event, state }) => {
      if (event === 'debugMode:update') {
        this.isVisible = state.debugMode;
        this.toggleVisibility();
      }
    });
    
    // Initial state
    this.isVisible = graphStore.state.debugMode;
    this.toggleVisibility();
    
    this.initSliders();
  }

  toggleVisibility() {
    if (this.container) {
      this.container.style.display = this.isVisible ? 'flex' : 'none';
    }
  }

  initSliders() {
    // Slider-Konfiguration mit Mapping zu zentralem Store
    const SLIDER_CONFIGS = [
      { sliderId: 'linkDistanceSlider', valueId: 'linkDistanceValue', param: 'linkDistance', force: 'link', method: 'distance' },
      { sliderId: 'linkStrengthSlider', valueId: 'linkStrengthValue', param: 'linkStrength', force: 'link', method: 'strength' },
      { sliderId: 'chargeStrengthSlider', valueId: 'chargeStrengthValue', param: 'chargeStrength', force: 'charge', method: 'strength' },
      { sliderId: 'alphaDecaySlider', valueId: 'alphaDecayValue', param: 'alphaDecay', simulation: 'alphaDecay' },
      { sliderId: 'velocityDecaySlider', valueId: 'velocityDecayValue', param: 'velocityDecay', simulation: 'velocityDecay' },
      { sliderId: 'nodeRadiusSlider', valueId: 'nodeRadiusValue', param: 'nodeRadius', update: 'updateVisualParams' },
      { sliderId: 'nodeStrokeSlider', valueId: 'nodeStrokeValue', param: 'nodeStrokeWidth', update: 'updateVisualParams' },
      { sliderId: 'labelSizeSlider', valueId: 'labelSizeValue', param: 'labelFontSize', update: 'updateVisualParams' },
      { sliderId: 'linkStrokeSlider', valueId: 'linkStrokeValue', param: 'linkStrokeWidth', update: 'updateVisualParams' },
      { sliderId: 'arrowSizeSlider', valueId: 'arrowSizeValue', param: 'arrowSize', update: 'updateVisualParams' }
    ];

    SLIDER_CONFIGS.forEach(config => {
      const slider = document.getElementById(config.sliderId);
      const valueDisplay = document.getElementById(config.valueId);
      
      if (!slider) return;
      
      // Initial value
      const initialValue = getGraphParam(config.param);
      slider.value = initialValue;
      if (valueDisplay) valueDisplay.textContent = this.formatValue(initialValue);
      
      slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        if (valueDisplay) valueDisplay.textContent = this.formatValue(value);
        
        setGraphParam(config.param, value);
        
        if (config.update === 'updateVisualParams') {
            this.renderer.updateVisualParams();
        } else {
            this.renderer.updateSimulationParams();
            this.renderer.restartSimulation();
        }
      });
    });

    const resetBtn = document.getElementById('resetForces');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            resetGraphParams();
            // Update sliders
            SLIDER_CONFIGS.forEach(config => {
                const slider = document.getElementById(config.sliderId);
                const valueDisplay = document.getElementById(config.valueId);
                if (slider) {
                    const val = getGraphParam(config.param);
                    slider.value = val;
                    if (valueDisplay) valueDisplay.textContent = this.formatValue(val);
                }
            });
            this.renderer.updateVisualParams();
            this.renderer.updateSimulationParams();
            this.renderer.restartSimulation();
        });
    }
  }

  formatValue(value) {
    if (Math.abs(value) >= 10) return Math.round(value).toString();
    if (Math.abs(value) >= 1) return value.toFixed(1);
    return value.toFixed(3);
  }
}
