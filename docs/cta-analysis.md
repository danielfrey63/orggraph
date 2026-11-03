# CTA-Analyse OrgGraph

Vollstaendige Analyse aller Call-to-Actions und Benutzer-Interaktionen.

---

## 1. Header-Bereich

### 1.1 Suchfeld (Combo-Input)

| Element | `#comboInput`                                            |
| ------- | ---------------------------------------------------------- |
| Datei   | [index.html:15](index.html#L15), [app.js:5507](src/app.js#L5507) |

| Interaktion                     | Verhalten                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Tippen (input)**        | Debounced Suche: filtert Knoten nach Name oder ID, baut Dropdown-Liste auf                         |
| **Focus**                 | Oeffnet Dropdown, falls Eintraege vorhanden                                                        |
| **Blur**                  | Schliesst Dropdown mit Verzoegerung (damit Click auf Item noch registriert wird)                   |
| **Keydown Arrow-Down/Up** | Navigation durch Dropdown-Eintraege, setzt `is-active` Klasse                                    |
| **Keydown Enter**         | Waehlt aktiven Eintrag aus, mit Shift-Enter Multi-Root, schliesst Dropdown, loest Graph-Update aus |
| **Keydown Escape**        | Schliesst Dropdown ohne Auswahl                                                                    |
| **Change**                | Ruft `applyFromUI()` auf, aktualisiert den Graphen                                               |

| CSS-Feedback | Beschreibung                                                                         |
| ------------ | ------------------------------------------------------------------------------------ |
| `:focus`   | Border-Farbe wechselt zu `--active-toggle-bg`, Box-Shadow `rgba(99,102,241,0.2)` |

### 1.2 Dropdown-Liste (Combo-List)

| Element | `#comboList` > `li`                                    |
| ------- | ---------------------------------------------------------- |
| Datei   | [index.html:16](index.html#L16), [app.js:1098](src/app.js#L1098) |

| Interaktion         | Verhalten                                                            |
| ------------------- | -------------------------------------------------------------------- |
| **Mousedown** | Waehlt Eintrag aus (`chooseItem()`); mit Shift-Click: Multi-Root  |
| **Hover**     | Visuelles Highlight via CSS                                          |

| CSS-Feedback   | Beschreibung                                                     |
| -------------- | ---------------------------------------------------------------- |
| `:hover`     | Background wechselt zu `--control-hover`                       |
| `.is-active` | Background wechselt zu `--control-hover` (Keyboard-Navigation) |
| `cursor`     | `pointer`                                                      |

---

### 1.3 Tiefenregler (Depth Control)

| Element | `#depthControl` mit `.depth-up` und `.depth-down`           |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:20-27](index.html#L20-L27), [app.js:6188](src/app.js#L6188) |

| Interaktion                        | Verhalten                                                        |
| ---------------------------------- | ---------------------------------------------------------------- |
| **Click `.depth-up`**      | Erhoeht Tiefenwert um 1 (max 6), aktualisiert Display + Graph    |
| **Click `.depth-down`**    | Verringert Tiefenwert um 1 (min 0), aktualisiert Display + Graph |
| **Depth Input change/input** | Synchronisiert Display, ruft `applyFromUI()` auf               |

| CSS-Feedback           | Beschreibung                                                      |
| ---------------------- | ----------------------------------------------------------------- |
| `:hover` (Container) | `translateY(-1px)`, Box-Shadow verstaerkt sich                  |
| `:hover` (Buttons)   | Background wechselt zu `--control-hover`                        |
| Wertaenderung          | `depthValuePulse`-Animation: Scale `1 -> 1.2 -> 1` ueber 0.3s |
| Transition             | 0.2s ease auf allen Eigenschaften                                 |

---

### 1.4 Richtungs-Toggle (Direction Split)

| Element | `#directionToggle` mit `.direction-up` und `.direction-down` |
| ------- | ------------------------------------------------------------------ |
| Datei   | [index.html:30-37](index.html#L30-L37), [app.js:5626](src/app.js#L5626)  |

| Interaktion                         | Verhalten                                                         |
| ----------------------------------- | ----------------------------------------------------------------- |
| **Click `.direction-up`**   | Togglet Aufwaerts-Richtung; mindestens eine Richtung bleibt aktiv |
| **Click `.direction-down`** | Togglet Abwaerts-Richtung; mindestens eine Richtung bleibt aktiv  |

| CSS-Feedback            | Beschreibung                                                   |
| ----------------------- | -------------------------------------------------------------- |
| `.active`             | Background `--active-toggle-bg`, weisse Schrift              |
| `:hover` (Button)     | Background `--control-hover`                                 |
| `:hover` (Container)  | `translateY(-1px)`, Box-Shadow                               |
| Divider-Pseudo-Elemente | Trennlinie zwischen aktiv/inaktiv via `::after`/`::before` |

---

### 1.5 Toggle-Buttons (Toolbar)

#### 1.5.1 Management-Toggle

| Element | `#toggleManagement`                                             |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:39-41](index.html#L39-L41), [app.js:5469](src/app.js#L5469) |

| Interaktion     | Verhalten                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------- |
| **Click** | Togglet Management-Modus: blendet Basis-Personen (Nicht-Manager) ein/aus, aktualisiert Graph |

#### 1.5.2 Hierarchie-Toggle

| Element | `#toggleHierarchy`                                              |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:43-45](index.html#L43-L45), [app.js:5683](src/app.js#L5683) |

| Interaktion     | Verhalten                                                                           |
| --------------- | ----------------------------------------------------------------------------------- |
| **Click** | Wechselt zwischen Force-Layout und hierarchischem Layout; konfiguriert D3-Forces um |

#### 1.5.3 Labels-Toggle

| Element | `#toggleLabels`                                                 |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:47-49](index.html#L47-L49), [app.js:5496](src/app.js#L5496) |

| Interaktion     | Verhalten                                                |
| --------------- | -------------------------------------------------------- |
| **Click** | Blendet Knoten-Beschriftungen (Namen) im Graphen ein/aus |

#### 1.5.4 Fit-Button

| Element | `#fit`                                                          |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:51-53](index.html#L51-L53), [app.js:5537](src/app.js#L5537) |

| Interaktion     | Verhalten                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Click** | Berechnet Bounding-Box aller Knoten, zoomt/pant animiert (300ms Transition), sodass der gesamte Graph sichtbar ist |

#### 1.5.5 Simulations-Toggle

| Element | `#toggleSimulation`                                             |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:55-57](index.html#L55-L57), [app.js:5543](src/app.js#L5543) |

| Interaktion     | Verhalten                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| **Click** | Aktiviert/deaktiviert kontinuierliche Simulation; Knoten bewegen sich dauerhaft oder kommen zur Ruhe |

#### 1.5.6 Export-Button

| Element | `#exportBtn`                                                      |
| ------- | ------------------------------------------------------------------- |
| Datei   | [index.html:59-61](index.html#L59-L61), [export.js:41](src/export.js#L41) |

| Interaktion     | Verhalten                         |
| --------------- | --------------------------------- |
| **Click** | Oeffnet den Export-Dialog (Modal) |

**Gemeinsames CSS-Feedback aller Toggle-Buttons:**

| CSS-Feedback | Beschreibung                                                                           |
| ------------ | -------------------------------------------------------------------------------------- |
| `.active`  | Background `--active-toggle-bg`, weisse Schrift, Box-Shadow `rgba(99,102,241,0.4)` |
| `:hover`   | Background `--control-hover`, `translateY(-1px)`, Box-Shadow                       |
| `cursor`   | `pointer`                                                                            |
| Transition   | 0.2s ease                                                                              |

---

### 1.6 Debug-Button

| Element | `#debugBtn`                                                     |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:64-66](index.html#L64-L66), [app.js:5563](src/app.js#L5563) |

| Interaktion     | Verhalten                                                                            |
| --------------- | ------------------------------------------------------------------------------------ |
| **Click** | Togglet Debug-Modus: zeigt Koordinaten, Abstaende und Link-Labels auf dem Graphen an |

---

## 2. Graph-Bereich (SVG Canvas)

### 2.1 Graph-Knoten (Personen)

| Element | `g.node` (D3-generiert)               |
| ------- | --------------------------------------- |
| Datei   | [app.js:3065-3092](src/app.js#L3065-L3092) |

| Interaktion                         | Verhalten                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hover (mousemove)**         | Zeigt Tooltip mit Personen-Info: Name, ID, zugehoerige OEs, Attribute. Nutzt `d3.pointer()` und Zoom-Transform-Inversion fuer korrekte Positionierung |
| **Mouseleave**                | Verbirgt Tooltip                                                                                                                                        |
| **Drag (mousedown + move)**   | D3-Drag-Behavior: Knoten folgt dem Cursor, Simulation wird aufgeheizt (`alphaTarget(0.3)`), Position wird fixiert (`fx`/`fy`)                     |
| **Drag-Ende (mouseup)**       | Simulation kuehlt ab (`alphaTarget(0)`), Knoten wird freigegeben (`fx = null, fy = null`)                                                           |
| **Doppelklick**               | Setzt angeklickten Knoten als neuen Wurzelknoten, aktualisiert Suchfeld und Graph                                                                       |
| **Rechtsklick (contextmenu)** | Oeffnet Kontextmenue mit: "Teilbaum ausblenden", "Als Wurzel setzen", "Wurzel entfernen", Attribut-Submenue                                             |

### 2.2 SVG-Flaeche (Pan & Zoom)

| Element | `#graph` (SVG)                                                      |
| ------- | --------------------------------------------------------------------- |
| Datei   | [index.html:70](index.html#L70), [app.js:3567-3587](src/app.js#L3567-L3587) |

| Interaktion                    | Verhalten                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Mausrad (wheel)**      | Zoom rein/raus, Skalierung 0.2x bis 5x                                                                                              |
| **Drag auf Hintergrund** | Pan: verschiebt den sichtbaren Ausschnitt                                                                                           |
| **Mousemove**            | Cluster-Hover-Erkennung: prueft via `d3.polygonContains()` ob der Cursor ueber einem Cluster-Polygon liegt, zeigt Cluster-Tooltip |
| **Mouseleave**           | Verbirgt Tooltip                                                                                                                    |

### 2.3 Cluster-Polygone (OE-Flaechen)

| Element | `path.cluster` (D3-generiert)         |
| ------- | --------------------------------------- |
| Datei   | [app.js:2546-2559](src/app.js#L2546-L2559) |

| Interaktion     | Verhalten                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| **Hover** | Wird ueber SVG-Level `mousemove` erkannt (Hit-Test via `clustersAtPoint()`). Zeigt Cluster-Name als Tooltip |

### 2.4 Knoten-Kontextmenue

| Element | `.context-menu` (dynamisch erzeugt)   |
| ------- | --------------------------------------- |
| Datei   | [app.js:2421-2474](src/app.js#L2421-L2474) |

| Interaktion                         | Verhalten                                                            |
| ----------------------------------- | -------------------------------------------------------------------- |
| **Click auf Menuepunkt**      | Fuehrt zugehoerige Aktion aus (hide/root/attribute), schliesst Menue |
| **Mouseenter auf Menuepunkt** | Background-Highlight                                                 |
| **Mouseleave auf Menuepunkt** | Highlight entfernt                                                   |
| **Click ausserhalb**          | Schliesst Menue (globaler Document-Click-Handler)                    |

| CSS-Feedback            | Beschreibung                                                    |
| ----------------------- | --------------------------------------------------------------- |
| `.menu-item:hover`    | Background `#1f2937`                                          |
| `.menu-item.disabled` | `opacity: 0.5`, `cursor: default`, `pointer-events: none` |
| Box-Shadow              | `0 8px 24px rgba(0,0,0,0.2)`                                  |
| Transition              | 0.15s ease                                                      |

---

## 3. Legende (Sidebar)

### 3.1 Sektions-Header (OEs / Attribute / Ausgeblendet)

| Element | `.legend-header`                                                           |
| ------- | ---------------------------------------------------------------------------- |
| Datei   | [index.html:74-96](index.html#L74-L96), [app.js:6067-6090](src/app.js#L6067-L6090) |

| Interaktion     | Verhalten                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Click** | Klappt die zugehoerige Sektion ein/aus (`.legend-content` toggle). Ignoriert Klicks auf Buttons mit `data-ignore-header-click` |

| CSS-Feedback                   | Beschreibung                              |
| ------------------------------ | ----------------------------------------- |
| `:hover`                     | Background `--control-hover`            |
| `cursor`                     | `pointer`                               |
| `.expanded .codicon`         | Chevron zeigt nach unten (rotate 0deg)    |
| `.collapsed .codicon`        | Chevron zeigt nach rechts (rotate -90deg) |
| `.legend-content` Transition | `max-height` 0.3s ease-out              |

---

### 3.2 OE-Sektion

#### 3.2.1 OE-Legende-Eintraege

| Element | `.legend-row` in `#legend` |
| ------- | ------------------------------ |
| Datei   | [app.js:1587](src/app.js#L1587)   |

| Interaktion                         | Verhalten                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| **Click**                     | Togglet OE-Sichtbarkeit im `allowedOrgs`-Set; aktualisiert Graph                    |
| **Rechtsklick (contextmenu)** | Oeffnet OE-Kontextmenue mit: "Alle anzeigen", "Alle ausblenden", "Nur direkte Kinder" |
| **Hover**                     | Zeigt versteckte Action-Buttons (Icon-Buttons mit `opacity: 0 -> 1`)                |

| CSS-Feedback      | Beschreibung                                                       |
| ----------------- | ------------------------------------------------------------------ |
| `.active`       | Background mit Org-Farbe gemischt, weisse Schrift, 3px linker Rand |
| `:hover`        | Background `--control-hover`                                     |
| `.active:hover` | Org-Farbe/active-toggle-bg-Mix                                     |
| `cursor`        | `pointer`                                                        |

#### 3.2.2 OE-Baum-Chevrons

| Element | `.legend-tree-chevron`     |
| ------- | ---------------------------- |
| Datei   | [app.js:1549](src/app.js#L1549) |

| Interaktion     | Verhalten                                    |
| --------------- | -------------------------------------------- |
| **Click** | Klappt Unter-OEs in der Baumstruktur ein/aus |

| CSS-Feedback   | Beschreibung                             |
| -------------- | ---------------------------------------- |
| `.expanded`  | Chevron nach unten (0deg)                |
| `.collapsed` | Chevron nach rechts (-90deg)             |
| `:hover`     | Farbe `--text`, Background transparent |

#### 3.2.3 OE-Filter

| Element | `#oeFilter` + `#oeFilterBtn`                                  |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:84-87](index.html#L84-L87), [app.js:5390](src/app.js#L5390) |

| Interaktion                       | Verhalten                                        |
| --------------------------------- | ------------------------------------------------ |
| **Input (Tippen)**          | Filtert OE-Liste in Echtzeit nach Suchbegriff    |
| **Focus**                   | Suchfeld expandiert (Breite + Opacity-Animation) |
| **Blur**                    | Suchfeld kollabiert, wenn leer                   |
| **Click auf Filter-Button** | Loescht Filter, schliesst Suchfeld               |

| CSS-Feedback             | Beschreibung                                                 |
| ------------------------ | ------------------------------------------------------------ |
| `.legend-search-input` | Transition 0.3s ease, Breite von 0 auf `calc(100% - 30px)` |
| `.has-value`           | Opacity 1, bleibt sichtbar                                   |
| Container `:hover`     | Suchfeld wird sichtbar                                       |

#### 3.2.4 Alle OEs Toggle

| Element | `#toggleAllOes`                                                 |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:89-91](index.html#L89-L91), [app.js:5336](src/app.js#L5336) |

| Interaktion     | Verhalten                                |
| --------------- | ---------------------------------------- |
| **Click** | Waehlt alle OEs an oder ab (Bulk-Toggle) |

#### 3.2.5 OE-Sichtbarkeit Toggle

| Element | `#toggleOesVisibility`                                          |
| ------- | ----------------------------------------------------------------- |
| Datei   | [index.html:92-94](index.html#L92-L94), [app.js:5164](src/app.js#L5164) |

| Interaktion     | Verhalten                                                                            |
| --------------- | ------------------------------------------------------------------------------------ |
| **Click** | Blendet OE-Cluster-Polygone im Graphen komplett ein/aus; togglet `oesVisible` Flag |

| CSS-Feedback       | Beschreibung    |
| ------------------ | --------------- |
| `.active` (Auge) | Volle Opacity   |
| Nicht `.active`  | SVG-Opacity 0.5 |

---

### 3.3 Attribut-Sektion

#### 3.3.1 Alle Kategorien expandieren/kollabieren

| Element | `#expandAllAttributes`                                              |
| ------- | --------------------------------------------------------------------- |
| Datei   | [index.html:111-114](index.html#L111-L114), [app.js:5204](src/app.js#L5204) |

| Interaktion     | Verhalten                                                        |
| --------------- | ---------------------------------------------------------------- |
| **Click** | Expandiert oder kollabiert alle Attribut-Kategorien gleichzeitig |

#### 3.3.2 Attributliste laden

| Element | `#loadAttributes` + `#attributeFileInput`                         |
| ------- | --------------------------------------------------------------------- |
| Datei   | [index.html:115-117](index.html#L115-L117), [app.js:5695](src/app.js#L5695) |

| Interaktion                       | Verhalten                                                |
| --------------------------------- | -------------------------------------------------------- |
| **Click auf Button**        | Oeffnet nativen Datei-Dialog (`.txt`, `.csv`)        |
| **Datei gewaehlt (change)** | Laed Attribut-Datei, startet Fuzzy-Matching falls noetig |

#### 3.3.3 Alle Attribute Toggle

| Element | `#toggleAllAttributes`                                              |
| ------- | --------------------------------------------------------------------- |
| Datei   | [index.html:118-120](index.html#L118-L120), [app.js:5362](src/app.js#L5362) |

| Interaktion     | Verhalten                                      |
| --------------- | ---------------------------------------------- |
| **Click** | Waehlt alle Attribute an oder ab (Bulk-Toggle) |

#### 3.3.4 Attribute Sichtbarkeit Toggle

| Element | `#toggleAttributesVisibility`                                       |
| ------- | --------------------------------------------------------------------- |
| Datei   | [index.html:121-123](index.html#L121-L123), [app.js:5297](src/app.js#L5297) |

| Interaktion     | Verhalten                                             |
| --------------- | ----------------------------------------------------- |
| **Click** | Blendet Attribut-Ringe um die Knoten komplett ein/aus |

#### 3.3.5 Attribut-Kategorie-Header

| Element | `.attribute-tree-chevron`  |
| ------- | ---------------------------- |
| Datei   | [app.js:4351](src/app.js#L4351) |

| Interaktion     | Verhalten                                                               |
| --------------- | ----------------------------------------------------------------------- |
| **Click** | Klappt einzelne Kategorie ein/aus, aktualisiert `collapsedCategories` |

| CSS-Feedback   | Beschreibung                 |
| -------------- | ---------------------------- |
| `.expanded`  | Chevron nach unten           |
| `.collapsed` | Chevron nach rechts (-90deg) |
| `:hover`     | Farbe `--text`             |

#### 3.3.6 Kategorie-Aktions-Buttons

| Element | Kategorie-Download, Auge, Speichern                                                      |
| ------- | ---------------------------------------------------------------------------------------- |
| Datei   | [app.js:4386](src/app.js#L4386), [app.js:4402](src/app.js#L4402), [app.js:4450](src/app.js#L4450) |

| Interaktion               | Verhalten                                                         |
| ------------------------- | ----------------------------------------------------------------- |
| **Click Download**  | Exportiert Kategorie-Attribute als TSV-Datei                      |
| **Click Auge**      | Togglet Kategorie-Sichtbarkeit, aktualisiert `hiddenCategories` |
| **Click Speichern** | Exportiert modifizierte Kategorie-Attribute in Datei              |

| CSS-Feedback     | Beschreibung                                                       |
| ---------------- | ------------------------------------------------------------------ |
| Buttons initial  | `opacity: 0`, `pointer-events: none`                           |
| Zeile `:hover` | Buttons werden sichtbar (`opacity: 1`, `pointer-events: auto`) |
| `.hidden`      | `opacity: 0.3` (gedimmter Zustand)                               |

#### 3.3.7 Einzelne Attribut-Eintraege

| Element | `.legend-row` im Attribut-Bereich |
| ------- | ----------------------------------- |
| Datei   | [app.js:4521](src/app.js#L4521)        |

| Interaktion     | Verhalten                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------- |
| **Click** | Togglet individuelles Attribut im `activeAttributes`-Set; aktualisiert Attribut-Ringe im Graphen |

| CSS-Feedback                   | Beschreibung                                |
| ------------------------------ | ------------------------------------------- |
| `.active` mit Attribut-Farbe | Background `--attribute-bg`, Farb-codiert |
| `.active:hover`              | Background `--attribute-bg-hover`         |

---

### 3.4 Ausgeblendet-Sektion

#### 3.4.1 Entfernen-Button (Einblenden)

| Element | Remove-Button in Hidden-Legend |
| ------- | ------------------------------ |
| Datei   | [app.js:1493](src/app.js#L1493)   |

| Interaktion     | Verhalten                                                              |
| --------------- | ---------------------------------------------------------------------- |
| **Click** | Blendet zuvor ausgeblendeten Teilbaum wieder ein (`unhideSubtree()`) |

---

### 3.5 OE-Legende Kontextmenue

| Element | Dynamisches Kontextmenue                                                         |
| ------- | -------------------------------------------------------------------------------- |
| Datei   | [app.js:1690-1691](src/app.js#L1690-L1691), [app.js:1896-1918](src/app.js#L1896-L1918) |

| Interaktion                           | Verhalten                          |
| ------------------------------------- | ---------------------------------- |
| **Click auf Menuepunkt**        | Fuehrt Aktion aus, schliesst Menue |
| **Mouseenter**                  | Highlight-Background               |
| **Mouseleave**                  | Highlight entfernt                 |
| **Click ausserhalb (document)** | Schliesst Menue                    |

---

### 3.6 Attribut-Submenue (im Kontextmenue)

| Element | Mehrstufiges Submenue                   |
| ------- | --------------------------------------- |
| Datei   | [app.js:2072-2223](src/app.js#L2072-L2223) |

| Interaktion                             | Verhalten                                     |
| --------------------------------------- | --------------------------------------------- |
| **Mouseenter auf Eltern-Item**    | Oeffnet Submenue nach kurzer Verzoegerung     |
| **Mouseleave**                    | Schliesst Submenue mit Debounce-Timer         |
| **Click auf Eltern-Item**         | Togglet Submenue-Sichtbarkeit                 |
| **Mouseenter auf Kategorie-Item** | Oeffnet Kategorie-Submenue (3. Ebene)         |
| **Mouseleave Kategorie**          | Schliesst Kategorie-Submenue mit Verzoegerung |

---

## 4. Export-Dialog (Modal)

### 4.1 Dialog-Steuerung

| Element | `#exportModal`                                                               |
| ------- | ------------------------------------------------------------------------------ |
| Datei   | [index.html:169-210](index.html#L169-L210), [export.js:41-55](src/export.js#L41-L55) |

| Interaktion                  | Verhalten                  |
| ---------------------------- | -------------------------- |
| **Click auf Overlay**  | Schliesst Dialog           |
| **Click auf X-Button** | Schliesst Dialog           |
| **Keydown Escape**     | Schliesst Dialog           |
| **Keydown Enter**      | Loest aktiven Download aus |

| CSS-Feedback               | Beschreibung                   |
| -------------------------- | ------------------------------ |
| `.modal-close-btn:hover` | Farbe `--text-strong`        |
| Box-Shadow                 | `0 4px 24px rgba(0,0,0,0.2)` |

### 4.2 Format-Auswahl

| Element | `.format-btn` (SVG / PNG)                                             |
| ------- | ----------------------------------------------------------------------- |
| Datei   | [index.html:181-182](index.html#L181-L182), [export.js:80](src/export.js#L80) |

| Interaktion         | Verhalten                                                |
| ------------------- | -------------------------------------------------------- |
| **Click SVG** | Zeigt SVG-Optionen, verbirgt PNG-Optionen                |
| **Click PNG** | Zeigt PNG-Optionen mit Aufloesung, verbirgt SVG-Optionen |

| CSS-Feedback | Beschreibung                                                  |
| ------------ | ------------------------------------------------------------- |
| `.active`  | Background `--active-toggle-bg`, weisse Schrift, Box-Shadow |
| `:hover`   | Background `--control-hover`, Border-Farbe                  |

### 4.3 Aufloesung-Presets

| Element | `.resolution-preset`                                                    |
| ------- | ------------------------------------------------------------------------- |
| Datei   | [index.html:193-196](index.html#L193-L196), [export.js:101](src/export.js#L101) |

| Interaktion     | Verhalten                                                       |
| --------------- | --------------------------------------------------------------- |
| **Click** | Setzt Breite/Hoehe auf Preset-Werte, aktualisiert Custom-Felder |

| CSS-Feedback | Beschreibung                                      |
| ------------ | ------------------------------------------------- |
| `.active`  | Background `--active-toggle-bg`, weisse Schrift |
| `:hover`   | Background `--control-hover`, Border-Farbe      |

### 4.4 Benutzerdefinierte Aufloesung

| Element | `#customWidth`, `#customHeight`                                                |
| ------- | ---------------------------------------------------------------------------------- |
| Datei   | [index.html:201-202](index.html#L201-L202), [export.js:116-138](src/export.js#L116-L138) |

| Interaktion     | Verhalten                                              |
| --------------- | ------------------------------------------------------ |
| **Input** | Entfernt aktives Preset (benutzerdefiniert uebernimmt) |
| **Focus** | Text wird automatisch selektiert                       |
| **Click** | Text wird automatisch selektiert                       |

| CSS-Feedback | Beschreibung                              |
| ------------ | ----------------------------------------- |
| `:focus`   | Border `--active-toggle-bg`, Box-Shadow |

### 4.5 Download-Buttons

| Element | `#downloadSvg`, `#downloadPng`                                                                        |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Datei   | [index.html:187](index.html#L187), [index.html:205](index.html#L205), [export.js:144-147](src/export.js#L144-L147) |

| Interaktion         | Verhalten                                                      |
| ------------------- | -------------------------------------------------------------- |
| **Click SVG** | Exportiert aktuellen Graphen als SVG-Datei                     |
| **Click PNG** | Exportiert aktuellen Graphen als PNG mit gewaehlter Aufloesung |

| CSS-Feedback | Beschreibung                                                                         |
| ------------ | ------------------------------------------------------------------------------------ |
| `:hover`   | Background `--button-primary-hover`, `translateY(-2px)`, verstaerkter Box-Shadow |
| `:active`  | `translateY(0)` (zurueck auf Ausgangsposition)                                     |
| `cursor`   | `pointer`                                                                          |

---

## 5. Fuzzy-Match-Dialog

Wird beim Laden von Attribut-Dateien angezeigt, wenn keine exakte Zuordnung moeglich ist.

### 5.1 Dialog-Steuerung

| Datei | [app.js:4559-4610](src/app.js#L4559-L4610) |
| ----- | --------------------------------------- |

| Interaktion                  | Verhalten                    |
| ---------------------------- | ---------------------------- |
| **Click auf Overlay**  | Schliesst Dialog ohne Import |
| **Keydown Escape**     | Schliesst Dialog ohne Import |
| **Click auf X-Button** | Schliesst Dialog ohne Import |

### 5.2 Fuzzy-Match Combo-Eingabe

| Datei | [app.js:4821-4984](src/app.js#L4821-L4984) |
| ----- | --------------------------------------- |

| Interaktion                     | Verhalten                          |
| ------------------------------- | ---------------------------------- |
| **Input (Tippen)**        | Filtert Match-Optionen in Echtzeit |
| **Focus**                 | Oeffnet Dropdown, selektiert Text  |
| **Click**                 | Oeffnet Dropdown                   |
| **Keydown Arrow-Down/Up** | Navigation durch Optionen          |
| **Keydown Enter**         | Waehlt aktive Option               |
| **Keydown Escape**        | Schliesst Dropdown                 |
| **Window Resize**         | Repositioniert Dropdown            |
| **Click ausserhalb**      | Schliesst Dropdown                 |

### 5.3 Match-Optionen

| Datei | [app.js:4716-4756](src/app.js#L4716-L4756) |
| ----- | --------------------------------------- |

| Interaktion                              | Verhalten                            |
| ---------------------------------------- | ------------------------------------ |
| **Click "Keine Uebereinstimmung"** | Markiert Eintrag als unmatched       |
| **Click auf Match-Option**         | Waehlt Match aus, weist Attribute zu |

### 5.4 Bestaetigen-Button

| Datei | [app.js:5005](src/app.js#L5005) |
| ----- | ---------------------------- |

| Interaktion     | Verhalten                                        |
| --------------- | ------------------------------------------------ |
| **Click** | Finalisiert Fuzzy-Matching, importiert Attribute |

| CSS-Feedback | Beschreibung                          |
| ------------ | ------------------------------------- |
| `:hover`   | Background `--button-primary-hover` |

### 5.5 Abbrechen-Button (Fortschrittsanzeige)

| Datei | [app.js:4043](src/app.js#L4043), [app.js:4142](src/app.js#L4142) |
| ----- | ---------------------------------------------------------- |

| Interaktion     | Verhalten                                                              |
| --------------- | ---------------------------------------------------------------------- |
| **Click** | Setzt Abort-Flag, bricht Fuzzy-Search ab, entfernt Fortschrittsanzeige |

---

## 6. Footer-Bereich

### 6.1 Status-Anzeige

| Element | `#status`                                                  |
| ------- | ------------------------------------------------------------ |
| Datei   | [index.html:155](index.html#L155), [app.js:5127](src/app.js#L5127) |

| Interaktion     | Verhalten                                                    |
| --------------- | ------------------------------------------------------------ |
| **Click** | Oeffnet nativen Datei-Dialog zum Laden einer JSON-Datendatei |

| CSS-Feedback | Beschreibung        |
| ------------ | ------------------- |
| `:hover`   | `cursor: pointer` |

---

## 7. Globale Interaktionen

| Interaktion                         | Element      | Verhalten                                                                 |
| ----------------------------------- | ------------ | ------------------------------------------------------------------------- |
| **Rechtsklick (contextmenu)** | `document` | Browser-Kontextmenue wird global unterdrueckt                             |
| **Click irgendwo**            | `document` | Schliesst offene Kontextmenues und Dropdowns                              |
| **DOMContentLoaded**          | `window`   | Initialisiert gesamte Applikation, laedt Daten, richtet Event-Handler ein |

---

## 8. Zusammenfassung der Interaktionstypen

| Interaktionstyp                 | Anzahl CTAs                        |
| ------------------------------- | ---------------------------------- |
| Click                           | ~45                                |
| Hover (mouseenter/mousemove)    | ~15                                |
| Mouseleave                      | ~10                                |
| Keydown (Tastatur)              | ~5                                 |
| Input (Echtzeit-Eingabe)        | ~8                                 |
| Focus / Blur                    | ~6                                 |
| Change (Wertaenderung)          | ~5                                 |
| Doppelklick                     | 1                                  |
| Rechtsklick (contextmenu)       | 4                                  |
| Drag (D3)                       | 1 (3 Phasen: start/drag/end)       |
| Zoom/Pan (D3)                   | 1 (Mausrad + Drag auf Hintergrund) |
| Window Resize                   | 1                                  |
| **Gesamt Event-Listener** | **~100**                     |

---

## 9. CSS-Interaktionsmuster

| Muster                               | Verwendung                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| Hover-Lift (`translateY(-1px)`)    | Toggle-Buttons, Depth-Control, Direction-Split, Icon-Buttons                         |
| Reveal-on-Hover (`opacity 0 -> 1`) | Legend-Icon-Buttons, Attribute-Buttons (erscheinen erst bei Hover auf Eltern-Zeile)  |
| Active-State-Highlight               | Toggle-Buttons, Direction-Buttons, Format-Buttons, Resolution-Presets, Legend-Rows   |
| Chevron-Rotation (`0deg / -90deg`) | Alle Collapse-Chevrons (Legend-Sektionen, OE-Baum, Attribut-Kategorien)              |
| Focus-Ring (`box-shadow`)          | Suchfeld, Filter-Input, Custom-Resolution-Inputs                                     |
| Pulse-Animation                      | Tiefenwert-Aenderung (`depthValuePulse`)                                           |
| Smooth-Transition (0.2s)             | Fast alle interaktiven Elemente                                                      |
| Disabled-State                       | Kontextmenue-Items (`opacity: 0.5`, `pointer-events: none`, `cursor: default`) |
