export const SVG_ATTR = 'class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const ICON = {
  // --- toolbar ---
  layers:       `<svg ${SVG_ATTR}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
  arrowUp:      `<svg ${SVG_ATTR}><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
  arrowDown:    `<svg ${SVG_ATTR}><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
  organization: `<svg ${SVG_ATTR}><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v3M5 17v-3h14v3M12 10v4"/></svg>`,
  hierarchy:    `<svg ${SVG_ATTR}><rect x="3" y="3" width="9" height="7" rx="1"/><rect x="12" y="14" width="9" height="7" rx="1"/><path d="M7.5 10v4a3 3 0 0 0 3 3H12"/></svg>`,
  tag:          `<svg ${SVG_ATTR}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
  property:     `<svg ${SVG_ATTR}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="14" y2="13"/><line x1="7" y1="17" x2="11" y2="17"/></svg>`,
  move:         `<svg ${SVG_ATTR}><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
  sync:         `<svg ${SVG_ATTR}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`,
  save:         `<svg ${SVG_ATTR}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`,
  shield:       `<svg ${SVG_ATTR}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  bug:          `<svg ${SVG_ATTR}><rect x="8" y="6" width="8" height="14" rx="4"/><line x1="8" y1="13" x2="16" y2="13"/><path d="M12 2v4M19 7l-3 2M5 7l3 2M3 13h3M18 13h3M5 19l3-1.5M19 19l-3-1.5"/></svg>`,

  // --- legend / actions ---
  filter:       `<svg ${SVG_ATTR}><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
  checkAll:     `<svg ${SVG_ATTR}><polyline points="1 12 5 16 12 9"/><polyline points="9 14 11 16 18 9"/></svg>`,
  check:        `<svg ${SVG_ATTR}><polyline points="20 6 9 17 4 12"/></svg>`,
  eye:          `<svg ${SVG_ATTR}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeClosed:    `<svg ${SVG_ATTR}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
  chevronDown:  `<svg ${SVG_ATTR}><polyline points="6 9 12 15 18 9"/></svg>`,
  cloudUpload:  `<svg ${SVG_ATTR}><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,
  cloudDownload:`<svg ${SVG_ATTR}><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>`,
  close:        `<svg ${SVG_ATTR}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  plus:         `<svg ${SVG_ATTR}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  edit:         `<svg ${SVG_ATTR}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 21.5 2 23l1.5-5.5L17 3z"/></svg>`,
  copy:         `<svg ${SVG_ATTR}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  trash:        `<svg ${SVG_ATTR}><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
};

/** Replace an element's icon (sets data-icon + innerHTML). */
export function setIcon(el, name) {
  if (!el) return;
  el.dataset.icon = name;
  el.innerHTML = ICON[name] || '';
}

/** Inject SVGs into every [data-icon] element under `root` (idempotent). */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(el => {
    const name = el.dataset.icon;
    if (ICON[name]) el.innerHTML = ICON[name];
  });
}

// Hydrate static markup as soon as this module evaluates (DOM is already parsed
// for deferred module scripts and for the inlined standalone script at body end).
hydrateIcons();



// ===== src/export.js =====

/**
 * Export-Funktionen für Grafiken
 */

// Globale Export-Variablen
