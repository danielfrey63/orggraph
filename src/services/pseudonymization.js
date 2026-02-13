import { Logger } from '../utils/logger.js';
import { graphStore } from '../state/store.js';
import { getOrgDepth } from '../graph/adjacency.js';

/**
 * Service class for Pseudonymization logic
 */
class PseudonymizationService {
  constructor() {
    this.pseudoData = null; // { names: [], organizationalUnits0: [], ... }
    this.pseudoNameMapping = new Map();   // originalName -> pseudoName
    this.pseudoOrgMapping = new Map();    // originalOrgLabel -> pseudoOrgLabel
    this.pseudoNameIndex = 0;
    this.pseudoOrgIndices = new Map();    // level -> currentIndex
  }

  /**
   * Loads pseudonymization data from pseudo.data.json
   */
  async loadPseudoData() {
    try {
      const res = await fetch('./pseudo.data.json', { cache: 'no-store' });
      if (!res.ok) {
        Logger.log('[Pseudo] Konnte pseudo.data.json nicht laden:', res.status);
        return false;
      }
      this.pseudoData = await res.json();
      Logger.log('[Pseudo] Daten geladen:', {
        names: this.pseudoData.names?.length || 0,
        orgLevels: Object.keys(this.pseudoData).filter(k => k.startsWith('organizationalUnits')).length
      });
      return true;
    } catch (_e) {
      Logger.log('[Pseudo] Fehler beim Laden:', _e);
      this.pseudoData = null;
      return false;
    }
  }

  /**
   * Get pseudo name for a person (consistent mapping)
   */
  getPseudoName(originalName) {
    if (!this.pseudoData?.names?.length) return originalName;
    
    const key = String(originalName);
    if (this.pseudoNameMapping.has(key)) {
      return this.pseudoNameMapping.get(key);
    }
    
    // Create new mapping
    const pseudoName = this.pseudoData.names[this.pseudoNameIndex % this.pseudoData.names.length];
    this.pseudoNameIndex++;
    this.pseudoNameMapping.set(key, pseudoName);
    return pseudoName;
  }

  /**
   * Get pseudo label for an org unit based on level (consistent mapping)
   */
  getPseudoOrgLabel(originalLabel, level) {
    if (!this.pseudoData) return originalLabel;
    
    const key = String(originalLabel);
    if (this.pseudoOrgMapping.has(key)) {
      return this.pseudoOrgMapping.get(key);
    }
    
    // Find level-based org list
    const levelKey = `organizationalUnits${level}`;
    const orgList = this.pseudoData[levelKey];
    
    if (!orgList || !Array.isArray(orgList) || orgList.length === 0) {
        return originalLabel;
    }
    
    // Create new mapping
    const idx = this.pseudoOrgIndices.get(level) || 0;
    const pseudoOrg = orgList[idx % orgList.length];
    this.pseudoOrgIndices.set(level, idx + 1);
    this.pseudoOrgMapping.set(key, pseudoOrg.name);
    return pseudoOrg.name;
  }

  /**
   * Get display label for a node (person or org)
   * @param {Object} node - Node object with id, label, type
   * @param {number} [level] - Optional: Org level
   * @param {Map} [parentOfMap] - Optional: parentOf map for depth calculation if level is missing
   */
  getDisplayLabel(node, level, parentOfMap) {
    if (!node) return '';
    
    const originalLabel = node.label || node.id || '';
    const { pseudonymizationEnabled } = graphStore.state;
    
    // If pseudonymization disabled or no data, return original
    if (!pseudonymizationEnabled || !this.pseudoData) {
      return originalLabel;
    }
    
    // Person
    if (node.type === 'person') {
      return this.getPseudoName(originalLabel);
    }
    
    // Org
    if (node.type === 'org') {
      let orgLevel = level;
      if (orgLevel === undefined) {
          // If level not provided, try to calculate using provided map or store
          const pMap = parentOfMap || graphStore.state.parentOf;
          orgLevel = getOrgDepth(node.id, pMap);
      }
      return this.getPseudoOrgLabel(originalLabel, orgLevel);
    }
    
    return originalLabel;
  }
}

export const pseudonymizationService = new PseudonymizationService();
