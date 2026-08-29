# Component Inventory — orggraph

Wird vom `component-audit`-Skill gelesen. Definiert, was in diesem Projekt als Factory gilt, was als Bypass zählt und welche Dateien gescannt werden. Lebendes Dokument: jede neue oder erweiterte Factory und jede akzeptierte Ausnahme kommt im selben Zug hier hinein.

## Target files

- `src/sections/*.js`
- `index.template.html` — die Quelle; `index.html` ist der Build-Output (`node build.js`) und wird NICHT separat auditiert
- `src/styles.css`

## Factories

- `setIcon(el, name)` / `hydrateIcons(root)` (02-icons.js) — SVG aus der `ICON`-Registry injizieren. Statisches Chrome im Template nutzt `<i data-icon="…"></i>` (wird beim Laden hydriert), dynamisches Chrome `setIcon`. Bypass = Inline-`<svg>`, `innerHTML` mit Roh-SVG ausserhalb der Registry, parallele Getter-APIs oder Unicode-Glyphen (`+`, `✕`, `✎`, `⧉`, `▸`) als Icon-Ersatz. Fehlt ein Icon, wird es in der Registry ergänzt (Feather-Stil, `SVG_ATTR`).
- `renderOrgLegendNode(node, depth)` (12-legend-org.js) — erzeugt `.legend-row` mit `.legend-row-left` / `.legend-row-right`. Bypass = manuelle Legend-Row-Konstruktion.
- `createLegendRow({ active, withRight })` (12-legend-org.js) — Row-Skelett `.legend-row` + Areas; gibt `{ row, left, right }` zurück. Bypass = manuelles `createElement` mit `legend-row`-Klassen.
- `createLegendChevron({ collapsed, onToggle })`, `createLegendTreeSpacer()`, `createLegendDepthSpacer(px)`, `createLegendChip(text, title)`, `createLegendIconButton({ icon|svg, title, className, onClick })` (12-legend-org.js) — Bausteine aller Legend-Rows (OE-, Hidden-, Attribut-, Views-Legende). Bypass = Hand-Konstruktion von `.legend-tree-chevron`, `.legend-tree-spacer`, `.legend-depth-spacer`, `.legend-label-chip` oder `.legend-icon-btn`. Hinweis: State-Mutationen an bestehenden Buttons (className/Icon-Toggle, z.B. 11-graph-core.js, Eye-Toggle in 16) sind KEINE Bypässe.
- `setLegendSubtreeCollapsed(chevron, collapsed)` (12-legend-org.js) — einziger Besitzer des Auf-/Zuklapp-Zustands eines Legend-Teilbaums (`<ul>`-Display + `expanded`/`collapsed`-Klasse des Chevrons); genutzt vom Chevron-Klick, «nur direkte Kinder» (12) und Collapse-/Expand-All (18). Bypass = `ul.style.display` + Chevron-Klasse von Hand setzen. Ausnahme: der Initialzustand beim Bau der Liste (`itemsUl.style.display` in 16).
- `createSubmenuItem(label, handler, { arrow, disabled })` / `createCategorySubmenuItem(...)` (12-legend-org.js) — erzeugen `.menu-item`-Einträge (Label-Span, optional `.menu-item-arrow`, optional `.disabled`). Alle Menüeinträge laufen hier durch — auch die `mkItem`/`addItem`-Wrapper in ensureLegendMenu/showNodeMenu. Bypass = manuelle `.menu-item`-Divs.
- `createComboHint(text, { more })` (10-combo.js) — informative Einträge der Such-Dropdown (`.combo-hint`, `.combo-hint--more`). Bypass = `<li class="combo-hint">` per innerHTML oder createElement.
- `showTemporaryNotification(msg)` (01-config-status.js) — Singleton-Toast. Bypass = jedes ad-hoc fixed-positionierte Status-Element.
- `createModal({ id, title, onClose })` (03-export-dialog.js) — Laufzeit-Modal nach dem `#exportModal`-Vertrag: `.modal.open > .modal-overlay + .modal-container > .modal-header (h2 + ×) + .modal-content`; gibt `{ modal, content, close }` zurück, Overlay-Klick und × schliessen. `showPasswordDialog(...)` (07-password-roots.js) baut darauf auf. Bypass = manuelle `.modal*`-Konstruktion oder Inline-Styles an Modal-Teilen.
- `initializeExport()` (03-export-dialog.js) — verdrahtet das vorgebaute `#exportModal`-Markup aus index.template.html; Sichtbarkeit NUR über `.modal.open`. `buildExportClone(svg)` / `buildExportStylesheet({ withBody })` (modul-intern, 03) — Export-Klon und Inline-Stylesheet für SVG/PNG-Export. Bypass = zweites `<style>`-Template im Export-Pfad.
- **Statische Footer-Widgets** (`index.template.html`, `.footer-stats`): `#timeControls` (hidden, von `og2BuildTimeControls` enthüllt), `#profileSwitcher` (von `renderProfileSwitcher` befüllt), `#resetData` (von 18-files-reset verdrahtet). Trennstriche `.stat-separator` stehen im Template. JS enthüllt (`el.hidden`), füllt und verdrahtet nur (`dataset.wired`). Bypass = Footer-Chrome per `createElement`/`innerHTML` in JS mounten.

## Layout contracts (CSS-Klassen, die Teil des Komponentenvertrags sind)

- `[hidden]` — globale Utility (`display: none !important`); Show/Hide von Chrome läuft über `el.hidden` bzw. das `hidden`-Attribut im Template, nicht über `style.display`
- `.legend-row`, `.legend-row-left`, `.legend-row-right`, `.legend-list`, `.legend-label-chip`, `.legend-depth-spacer`, `.legend-tree-chevron`, `.legend-tree-spacer`
- `.legend-icon-btn` (+ `.active`, `.hidden`, `.visible`) — genau ein Regelblock in styles.css
- `.legend-chevron` (+ `.expanded`/`.collapsed`) — Sektions-Chevron im Template mit `<i data-icon="chevronDown">`
- `.node-context-menu`, `.menu-item`, `.menu-item-label`, `.menu-item-arrow`
- `.modal` (+ `.open`), `.modal-overlay`, `.modal-container`, `.modal-header`, `.modal-content`, `.modal-close-btn`, `.modal-input` (+ `.modal-input--error`), `.modal-error`, `.modal-btn-row`
- `.combo`, `.combo-input`, `.combo-list`, `.is-active`, `.combo-hint` (+ `.combo-hint--more`)
- `.attribute-color-dot` — Farbring der Attribut-Legende; nur `borderColor` inline
- `.toast` — temporäre Notification; nur `opacity` inline (Fade)
- `.cluster-tooltip` — Cluster-Tooltip (ensureTooltip); nur `left`/`top`/`display` inline
- `.no-matches-message` — Leermeldung der OE-Suche
- `.label`, `.link-label` — Graph-Labels (d3, 14-render.js); Präsentation in CSS, nur `display` inline (Debug-/Sichtbarkeits-Toggle)
- `.time-controls`, `.profile-switcher`, `.profile-btn`, `.footer-reset-btn`, `.stat-separator` — Footer-Chrome (Template)

## Bypass patterns (grep recipes)

1. Bulk-Inline-Styling, das eine CSS-Klasse imitiert: `style\.cssText\s*=` — jeder Treffer ist verdächtig, ausser er setzt nur dynamische Werte (Koordinaten, berechnete Breite).
2. Wiederholte Einzel-Property-Blöcke (4+ aufeinanderfolgende `\.style\.[a-zA-Z]+\s*=` am selben Element) — gehört in eine CSS-Klasse.
3. Manuelle Legend-Rows: `className\s*=\s*['"]legend-row['"]` ausserhalb `createLegendRow`.
4. Manuelle Menüeinträge: `className\s*=\s*['"]menu-item` ausserhalb `createSubmenuItem`/`createCategorySubmenuItem`.
5. Manuelle Chips/Bausteine: `className\s*=\s*['"](legend-label-chip|legend-tree-chevron|legend-tree-spacer|legend-depth-spacer|legend-icon-btn|combo-hint)` ausserhalb der jeweiligen Factory in 12 bzw. 10.
6. Fixed-Position-Overlays in JS (`position:\s*fixed`) ausserhalb der Dialog-/Toast-Factories.
7. Show/Hide von Chrome über Inline-Display: `style\.display\s*=` in JS und `style="display:` im Template — erlaubt nur für Kontextmenü (12), Tooltip (08) und das Auf-/Zuklappen von Legend-Teilbäumen (`<ul>`; siehe Ausnahmen). Sonst `el.hidden` bzw. `.modal.open`.
8. Roh-`<svg`-Strings oder Icon-Markup ausserhalb der `ICON`-Registry (02-icons.js); Glyph-Icons: `textContent\s*=\s*['"][+✕✎⧉▸▾×]['"]`.
9. Modal-Konstruktion von Hand: `className\s*=\s*['"]modal` ausserhalb `createModal`; Modal-Sichtbarkeit über `style.display` statt `.open`.
10. Footer-Chrome in JS: `className\s*=\s*['"](stat-separator|profile-switcher|time-controls|footer-reset-btn)` — gehört als statisches Markup ins Template.
11. UI-Templates per `innerHTML\s*=\s*['"\`]<` in den Sections (Leeren mit `innerHTML = ''` ist ok) — statisches Chrome gehört ins Template, dynamisches in eine Factory.
12. Zweites Export-Stylesheet: `createElement\(['"]style['"]\)` ausserhalb `buildExportStylesheet`.
13. Statische Inline-Werte unter dem Deckmantel «dynamisch»: `\.style\.(cursor|background|margin\w*|padding\w*|zIndex)\s*=` mit Literal — gehört in CSS.
14. Tote Contract-Klassen: jede Klasse in styles.css ohne Produzenten in Sections oder Template (`grep -o '\.[a-z][a-z0-9-]*' styles.css | sort -u` gegen `grep -rho` über src/sections + index.template.html) — löschen oder verdrahten.

## Known legitimate exceptions (zuletzt hinterfragt 2026-08-29, Runde 2)

- Dynamische Werte bleiben inline — abschliessende Liste: Kontextmenü `left`/`top`/`display` (12), Tooltip `left`/`top`/`display` (08), Toast `opacity` (01), `.attribute-color-dot` `borderColor` (16), `createLegendDepthSpacer` `width` (12), Custom-Properties `--org-fill`/`--org-stroke` (12) und `--attribute-bg`/`--attribute-bg-hover` (16) an Legend-Rows, d3-`.style()`/`.attr()` mit Laufzeitwerten (08, 13, 14). Alles andere unter diesem Label (Cursor, Hintergrund, Abstände, Literal-Farben/-Schriftgrössen, Display-Toggles an Chrome) ist ein Bypass.
- Auf-/Zuklappen von Legend-Teilbäumen über `ul.style.display` — NUR am `<ul>` und NUR über `setLegendSubtreeCollapsed` (12) bzw. den Initialzustand beim Listenbau (`itemsUl.style.display` in 16); Unit-Tests prüfen `style.display` am `<ul>`. Sichtbarkeit einzelner `<li>` (OE-Filter in 18) läuft über `li.hidden` und fällt NICHT unter diese Ausnahme.
- `03-export-dialog.js` verdrahtet das vorgebaute `#exportModal`-Markup — Markup im Template IST das Factory-Muster; gilt nur für das Markup, die Sichtbarkeit läuft über `.open`. Das einzige `createElement('style')` in 03 liegt in `buildExportStylesheet` und zielt auf den Export-Klon.
- SVG-Namespace-Erzeugung fürs d3-Rendering (14-render.js; 11-graph-core.js erzeugt kein SVG) ist Canvas-Zeichnung, nicht UI-Chrome — eingeengt auf Element-Erzeugung und datengetriebene Attribute/Styles; literale Präsentation (Schriftgrösse, Farbe, pointer-events) gehört nach styles.css (`.label`, `.link-label`).
- `05-dropzone.js` baut das Drop-Panel aus einem Template-String: eine Stelle, in sich geschlossen, alle Klassen in styles.css. Eingeengt auf das Panel-Markup: Icons darin kommen aus `ICON`, der File-Picker wird über `hidden` versteckt.
- `.no-matches-message` (18-files-reset.js): eine Stelle, Vertragsklasse vorhanden, keine Duplikation.

## Gestrichen (existiert nicht mehr — nicht erneut eintragen)

- `17-fuzzy-dialog.js` / `.fuzzy-match-*`, `.progress-*`, Drag-Ghost: mit v1 abgebaut (siehe 15-ui-apply-search.js).
- `.combo-list-floating`, `.combo-list li.no-results`, `.menu-divider`, `.node-context-menu[data-level]`, `.legend-list .twisty`, `.modal-title`: tote Klassen, 2026-08-29 (Runde 1) aus styles.css entfernt.
- Zweite Attribut-Legende-Implementierung `.attribute-tree-*`, `.attribute-eye-btn`, `.attribute-check-all-btn`, `.attribute-tree-checkbox`, `.attribute-legend-item`, `.attribute-name`/`-color`/`-count`/`-toggle`/`-actions`, `.attributes-hidden`, `.legend-checkbox`; totes Menü `.legend-ellipsis*`; Richtungs-Toggle `.direction-*`; `.oe-filter-*`; `.legend-controls`/`.control-group`; `.attribute-category-header .collapse-btn` (samt Selektor in 19); `body > .combo-list`-Reste des Fuzzy-Dialogs: 2026-08-29 (Runde 2) entfernt, ~380 Zeilen. Live sind `.legend-row*`, `.legend-tree-*`, `.legend-icon-btn`, `.node-context-menu`/`.menu-item*`, `.depth-*`, `.legend-search-*`.
- Parallele Icon-Getter (`getCheckboxSVG`, `getEyeSVG`, `getSaveSVG`, `getDownloadSVG`, `getCheckAllSVG`, `getChevronSVG`, `updateCheckboxIcon`, `initializeChevronIcons`): 2026-08-29 gelöscht; `setIcon`/`data-icon` sind der einzige Weg. Glyph-Icons `+ ✕ ✎ ⧉ ▶ Δ ⬇` ebenfalls (Registry: `plus`, `close`, `edit`, `copy`, `chevronRight`, `diff`, `arrowDown`).
- `.view-row` (30-og2-ui.js): Klasse ohne CSS-Regel, entfernt; Views-Rows werden über `#viewsLegend .legend-row` gestylt, `.view-row-invalid` bleibt.

## Recommended verification command

`npm test && npm run verify` — zusätzlich `npm run e2e` (Playwright-Smoke, braucht einmalig `npx playwright install chromium`), sobald Template, Dialoge oder Footer betroffen sind.
