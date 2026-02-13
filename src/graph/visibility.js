import { graphStore } from '../state/store.js';
import { collectReportSubtree } from './adjacency.js';

export class VisibilityManager {
  constructor() {
    this.unsubscribe = graphStore.subscribe(this.handleStoreUpdate.bind(this));
  }
  
  handleStoreUpdate({ event, state }) {
    if (event === 'allHiddenTemporarilyVisible:update') {
      // Recompute visibility based on new flag
      this.updateVisibility(state);
    }
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
  }

  /**
   * Toggles visibility of a subtree rooted at `nodeId`
   */
  toggleVisibility(nodeId) {
    const { hiddenByRoot, hiddenNodes, temporarilyVisibleRoots } = graphStore.state;
    const sid = String(nodeId);
    
    const isHidden = hiddenByRoot.has(sid);
    
    const newHiddenByRoot = new Map(hiddenByRoot);
    const newHiddenNodes = new Set(hiddenNodes);
    const newTemporarilyVisibleRoots = new Set(temporarilyVisibleRoots);

    if (isHidden) {
      // Unhide
      const nodesToReveal = newHiddenByRoot.get(sid);
      if (nodesToReveal) {
        for (const id of nodesToReveal) {
          newHiddenNodes.delete(id);
        }
      }
      newHiddenByRoot.delete(sid);
      newTemporarilyVisibleRoots.delete(sid); // cleanup
    } else {
      // Hide
      const subtree = collectReportSubtree(sid, graphStore.state.parentOf);
      // Remove root itself from hiding list (root stays visible as anchor)
      subtree.delete(sid);
      
      if (subtree.size > 0) {
        newHiddenByRoot.set(sid, subtree);
        for (const id of subtree) {
          newHiddenNodes.add(id);
        }
      }
    }
    
    // Updates store
    graphStore.setHiddenByRoot(newHiddenByRoot);
    graphStore.setHiddenNodes(newHiddenNodes);
    graphStore.setTemporarilyVisibleRoots(newTemporarilyVisibleRoots);
    graphStore.setCurrentHiddenCount(newHiddenNodes.size);
    
    return !isHidden; // return new state (true = hidden, false = visible)
  }

  /**
   * Toggle temporary visibility for a specific hidden root
   */
  toggleTemporaryVisibility(rootId) {
    const { temporarilyVisibleRoots, hiddenByRoot } = graphStore.state;
    const sid = String(rootId);
    
    if (!hiddenByRoot.has(sid)) return; // Not hidden, nothing to toggle

    const newTemp = new Set(temporarilyVisibleRoots);
    if (newTemp.has(sid)) {
      newTemp.delete(sid);
    } else {
      newTemp.add(sid);
    }
    
    graphStore.setTemporarilyVisibleRoots(newTemp);
  }
  
  /**
   * Check if a node is currently effectively hidden
   * (Considers global toggle and specific temporary visibility)
   */
  isNodeHidden(nodeId) {
    const { hiddenNodes, allHiddenTemporarilyVisible, hiddenByRoot, temporarilyVisibleRoots } = graphStore.state;
    const sid = String(nodeId);
    
    if (!hiddenNodes.has(sid)) return false;
    
    // If global "show all hidden" is on, it's not hidden visually
    if (allHiddenTemporarilyVisible) return false;
    
    // Check if it belongs to a temporarily visible root
    // This is slow if we iterate all roots. Better: find which root hid this node.
    // Optimization: hiddenByRoot maps Root -> Set(Nodes).
    // Reverse lookup or check logic. 
    // For now, simpler: iterate hiddenByRoot keys.
    for (const [rootId, hiddenSet] of hiddenByRoot.entries()) {
      if (hiddenSet.has(sid)) {
        if (temporarilyVisibleRoots.has(rootId)) return false;
      }
    }
    
    return true;
  }
  
  updateVisibility() {
    // Logic to force refresh/recalc if needed
    // Usually handled by renderer observing store
  }
}
