import { INPUT_COMBO_ID, LIST_COMBO_ID, MAX_DROPDOWN_ITEMS, MIN_SEARCH_LENGTH, MAX_ROOTS } from '../constants.js';
import { graphStore } from '../state/store.js';
import { pseudonymizationService } from '../services/pseudonymization.js';
import { Logger } from '../utils/logger.js';
import { showTemporaryNotification } from '../utils/dom.js';

export class SearchUI {
  constructor(onUpdate) {
    this.onUpdate = onUpdate; // Optional callback if app needs to do something specific
    this.filteredItems = [];
    this.activeIndex = -1;
    this.searchDebounceTimer = null;
    this.input = null;
    this.list = null;
    
    // Subscribe to store updates to keep input in sync
    this.unsubscribe = graphStore.subscribe(({ event }) => {
      if (event === 'currentSelectedId:update' || event === 'pseudonymization:update') {
        this.refreshInput();
      }
    });
  }

  init() {
    this.input = document.querySelector(INPUT_COMBO_ID);
    this.list = document.querySelector(LIST_COMBO_ID);
    if (this.input && this.list) {
      this.attachHandlers();
      // Initial refresh
      this.refreshInput();
    }
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
  }

  getDisplayLabel(node) {
    return pseudonymizationService.getDisplayLabel(node);
  }

  populateCombo(filterText) {
    if (!this.input || !this.list) return;
    
    const { allNodesUnique } = graphStore.state;
    const term = (filterText || '').toLowerCase().trim();

    if (!term) {
      this.list.innerHTML = '';
      this.list.hidden = true;
      this.filteredItems = [];
      this.activeIndex = -1;
      return;
    }

    if (term.length > 0 && term.length < MIN_SEARCH_LENGTH) {
      this.list.innerHTML = `<li style="padding: 8px; color: #666; font-style: italic;">Mindestens ${MIN_SEARCH_LENGTH} Zeichen eingeben...</li>`;
      this.list.hidden = false;
      this.filteredItems = [];
      this.activeIndex = -1;
      return;
    }

    this.filteredItems = [];
    let count = 0;
    
    // Search in allNodesUnique
    for (const n of allNodesUnique) {
      if (count >= MAX_DROPDOWN_ITEMS) break;

      const displayLabel = this.getDisplayLabel(n).toLowerCase();
      const idStr = String(n.id).toLowerCase();
      
      if (!term || displayLabel.includes(term) || idStr.includes(term)) {
        this.filteredItems.push(n);
        count++;
      }
    }

    this.filteredItems.sort((a, b) => this.getDisplayLabel(a).localeCompare(this.getDisplayLabel(b)));

    this.list.innerHTML = '';
    this.activeIndex = -1;
    const frag = document.createDocumentFragment();

    this.filteredItems.forEach((n, idx) => {
      const li = document.createElement('li');
      const displayLbl = this.getDisplayLabel(n);
      const { pseudonymizationEnabled } = graphStore.state;
      
      li.textContent = pseudonymizationEnabled ? displayLbl : `${displayLbl} — ${n.id}`;
      li.setAttribute('data-id', String(n.id));
      li.tabIndex = -1;
      
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const addMode = !!e.shiftKey;
        this.chooseItem(idx, addMode);
      });
      
      frag.appendChild(li);
    });

    if (count >= MAX_DROPDOWN_ITEMS) {
      const hint = document.createElement('li');
      hint.style.padding = '8px';
      hint.style.color = '#666';
      hint.style.fontStyle = 'italic';
      hint.style.borderTop = '1px solid #e5e7eb';
      hint.textContent = `Nur erste ${MAX_DROPDOWN_ITEMS} Ergebnisse angezeigt. Suchbegriff verfeinern...`;
      frag.appendChild(hint);
    }

    this.list.appendChild(frag);
    this.list.hidden = this.filteredItems.length === 0;
  }

  setActive(idx) {
    if (!this.list) return;
    const items = Array.from(this.list.children);
    items.forEach((el, i) => {
      if (i === idx) el.classList.add('is-active'); 
      else el.classList.remove('is-active');
    });
    this.activeIndex = idx;
    if (idx >= 0 && items[idx]) items[idx].scrollIntoView({ block: 'nearest' });
  }

  guessIdFromInput(val) {
    if (!val) return null;
    const { nodes } = graphStore.state.raw;
    if (!nodes) return null;

    const exactByLabel = nodes.find(n => (n.label || '') === val);
    if (exactByLabel) return String(exactByLabel.id);

    const exactById = nodes.find(n => String(n.id) === val);
    if (exactById) return String(exactById.id);

    const part = nodes.find(n => (n.label || '').toLowerCase().includes(val.toLowerCase()));
    return part ? String(part.id) : null;
  }

  chooseItem(idx, addMode) {
    if (!this.input || !this.list) return;
    if (idx < 0 || idx >= this.filteredItems.length) return;
    
    const n = this.filteredItems[idx];
    const nid = String(n.id);
    const { debugMode, selectedRootIds, currentSelectedId, lastSingleRootId } = graphStore.state;

    if (addMode) {
      if (debugMode) console.log('[ui] chooseItem addMode', { idx, nid });
      
      // If first Shift-Add, initialize multi-root list from current selection
      if (selectedRootIds.length === 0) {
        let seed = currentSelectedId || lastSingleRootId;
        if (!seed) {
          // Try to guess start from input
          const inputVal = this.input.value || '';
          const guessed = this.guessIdFromInput(inputVal);
          if (guessed && guessed !== nid) seed = guessed;
        }
        if (seed && String(seed) !== nid) {
          graphStore.addRoot(seed);
          if (debugMode) console.log('[roots] initial seed in chooseItem', { seed: String(seed) });
        }
      }
      
      // Check max roots
      if (selectedRootIds.length >= MAX_ROOTS && !selectedRootIds.includes(nid)) {
        showTemporaryNotification(`Maximal ${MAX_ROOTS} Roots`);
      } else {
        graphStore.addRoot(nid);
        // Also set as current selected for highlighting
        graphStore.setCurrentSelectedId(nid);
      }
    } else {
      Logger.log('[ui] chooseItem replaceMode', { idx, nid });
      graphStore.setSingleRoot(nid);
      // setSingleRoot also sets currentSelectedId in store, but explicit check doesn't hurt
    }

    this.input.value = this.getDisplayLabel(n);
    this.list.hidden = true;
    
    if (this.onUpdate) {
      this.onUpdate('comboSelect');
    }
  }

  attachHandlers() {
    this.input.addEventListener('input', (e) => {
      const val = e.target.value || '';
      if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.populateCombo(val);
      }, 150);
    });

    this.input.addEventListener('keydown', (e) => {
      const { key } = e;
      if (key === 'ArrowDown') {
        e.preventDefault();
        this.setActive(Math.min(this.activeIndex + 1, this.filteredItems.length - 1));
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        this.setActive(Math.max(this.activeIndex - 1, -1));
      } else if (key === 'Enter') {
        e.preventDefault();
        if (this.activeIndex >= 0) {
          this.chooseItem(this.activeIndex, e.shiftKey);
        } else {
           // Try to guess from input if no dropdown selection
           const val = this.input.value;
           const guessed = this.guessIdFromInput(val);
           if (guessed) {
             const { byId } = graphStore.state;
             const node = byId.get(guessed);
             if (node) {
               // Find index in filtered items or just select directly
               const idx = this.filteredItems.findIndex(n => String(n.id) === guessed);
               if (idx >= 0) {
                 this.chooseItem(idx, e.shiftKey);
               } else {
                 // Direct selection
                 if (e.shiftKey) graphStore.addRoot(guessed);
                 else graphStore.setSingleRoot(guessed);
                 this.list.hidden = true;
                 if (this.onUpdate) this.onUpdate('comboSelect');
               }
             }
           }
        }
      } else if (key === 'Escape') {
        this.list.hidden = true;
      }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (this.input && this.list && !this.input.contains(e.target) && !this.list.contains(e.target)) {
        this.list.hidden = true;
      }
    });
    
    this.input.addEventListener('focus', () => {
      if (this.input.value.length >= MIN_SEARCH_LENGTH) {
        this.populateCombo(this.input.value);
      }
    });
  }
  
  refreshInput() {
    const { currentSelectedId, byId } = graphStore.state;
    if (this.input && currentSelectedId) {
      const node = byId.get(String(currentSelectedId));
      if (node) {
        const newVal = this.getDisplayLabel(node);
        // Only update if different to avoid cursor jumping if typing
        if (this.input.value !== newVal && document.activeElement !== this.input) {
           this.input.value = newVal;
        } else if (document.activeElement !== this.input) {
           // Force update if not focused
           this.input.value = newVal;
        }
      }
    } else if (this.input && !currentSelectedId) {
        // Clear input if no selection? Or keep last? 
        // app.js didn't clear explicitly, but let's keep it safe.
    }
  }
}
