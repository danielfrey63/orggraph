# Component Inventory — orggraph

Used by the `component-audit` skill. Defines what counts as a factory, what counts as a bypass, and which files to scan in this project.

## Target files

- src/sections/*.js
- index.html
- src/styles.css

## Factories

- `setIcon(el, name)` / `hydrateIcons(root)` (02-icons.js) — inject SVG from the ICON registry. Bypass = inline `<svg>` markup or innerHTML with raw SVG outside the registry.
- `renderOrgLegendNode(node, depth)` (12-legend-org.js) — produces `.legend-row` with `.legend-row-left` / `.legend-row-right`. Bypass = manual legend-row construction.
- `createLegendRow({ active, withRight })` (12-legend-org.js) — Row-Skelett `.legend-row` + Areas; gibt `{ row, left, right }` zurück. Bypass = manuelles `createElement` mit `legend-row`-Klassen.
- `createLegendChevron({ collapsed, onToggle })`, `createLegendTreeSpacer()`, `createLegendDepthSpacer(px)`, `createLegendChip(text, title)`, `createLegendIconButton({ icon|svg, title, className, onClick })` (12-legend-org.js) — Bausteine aller Legend-Rows (OE-, Hidden-, Attribut-Legende). Bypass = Hand-Konstruktion von `.legend-tree-chevron`, `.legend-tree-spacer`, `.legend-depth-spacer`, `.legend-label-chip` oder `.legend-icon-btn`. Hinweis: State-Mutationen an bestehenden Buttons (className/Icon-Toggle, z.B. 11-graph-core.js, Eye-Toggle in 16) sind KEINE Bypässe.
- `createSubmenuItem(label, handler, { arrow, disabled })` / `createCategorySubmenuItem(...)` (12-legend-org.js) — produce `.menu-item` entries (label span, optional `.menu-item-arrow`, optional `.disabled`). All menu items route through this — also `mkItem`/`addItem` wrappers in ensureLegendMenu/showNodeMenu. Bypass = manual `.menu-item` divs.
- `showTemporaryNotification(msg)` (01-config-status.js) — singleton toast. Bypass = any ad-hoc fixed-position status element.
- `showPasswordDialog(...)` (07-password-roots.js) — modal dialog. Should share the modal CSS contract, not inline styles.
- `showFuzzyMatchDialog(...)` (17-fuzzy-dialog.js) — modal dialog via `.fuzzy-match-*` classes.
- `initializeExport()` (03-export-dialog.js) — wires the pre-built `#exportModal` markup from index.html.

## Layout contracts (CSS classes that are part of the component contract)

- `.legend-row`, `.legend-row-left`, `.legend-row-right`, `.legend-list`, `.legend-label-chip`, `.legend-depth-spacer`, `.legend-tree-chevron`, `.legend-tree-spacer`
- `.legend-icon-btn` (+ `.active`, `.hidden`)
- `.node-context-menu` (+ `[data-level]`), `.menu-item`, `.menu-item-label`, `.menu-item-arrow`, `.menu-divider`
- `.modal`, `.modal-overlay`, `.modal-container`, `.modal-header`, `.modal-content`, `.modal-close-btn`
- `.fuzzy-match-dialog-container`, `.fuzzy-match-dialog`, `.fuzzy-match-header`, `.fuzzy-match-content`, `.fuzzy-match-footer`
- `.progress-container`, `.progress-overlay`, `.progress-box`, `.progress-bar`, `.progress-bar-inner`
- `.combo`, `.combo-input`, `.combo-list`, `.is-active`
- `.combo-list-floating` (+ `.open`) — body-verankerte Dropdown-Variante (Fuzzy-Dialog); Show/Hide NUR über die `.open`-Klasse, Koordinaten inline
- `.combo-hint` (+ `.combo-hint--more`), `.no-results` — informative Listeneinträge
- `.attribute-color-dot` — Farbring der Attribut-Legende; nur `borderColor` inline
- `.toast` — temporäre Notification; nur `opacity` inline (Fade)
- `.cluster-tooltip` — Cluster-Tooltip (ensureTooltip); nur `left`/`top`/`display` inline
- `.no-matches-message` — Leermeldung der OE-Suche

## Bypass patterns (grep recipes)

1. Bulk inline styling that imitates a CSS class: `style\.cssText\s*=` — every hit is suspect unless it only sets dynamic values (coordinates, computed width).
2. Repeated single-property styling blocks (4+ consecutive `\.style\.[a-zA-Z]+\s*=` on the same element) — should be a CSS class.
3. Manual legend rows: `className\s*=\s*['"]legend-row['"]` outside `renderOrgLegendNode` and the legend builders listed in Factories.
4. Manual menu items: `className\s*=\s*['"]menu-item` outside `createSubmenuItem`/`createCategorySubmenuItem`.
5. Manual dividers: `borderTop` style assignments where `.menu-divider` exists.
6. Fixed-position overlay construction (`position:\s*fixed` in JS) outside the dialog factories listed above.
7. Hand-rolled show/hide via `style.cssText = 'display: none...'` where a `.hidden` utility class (or plain `style.display`) would do.
8. Raw `<svg` strings or icon markup outside 02-icons.js ICON registry.

## Known legitimate exceptions

- Dynamic values must stay inline: positioning of context menus (`left`/`top`), `progress-bar-inner.style.width`, drag-ghost coordinates, computed color values on chips/dots.
- `03-export-dialog.js` uses the pre-built `#exportModal` markup from index.html — that *is* the factory pattern for this dialog, not a bypass.
- SVG-namespace element creation for the d3-style graph rendering (14-render.js, 11-graph-core.js) is canvas drawing, not UI chrome — out of scope.

## Recommended verification command

`npm test && npm run verify`
