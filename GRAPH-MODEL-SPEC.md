# Graph-Modell-Spezifikation (Entwurf) — OrgGraph als Property-Graph

> **Status: Beschlossene Spezifikation (2026-07-02).** Dieses Dokument beschreibt die
> Weiterentwicklung des Datenmodells vom fixen Org-Chart zum allgemeinen, typisierten
> Property-Graphen. Alle vormals offenen Punkte sind entschieden (§14); der Ansatz ist
> die verbindliche Grundlage der Umsetzung — noch keine implementierte Realität.
> **Umsetzungsstrategie: Big Bang** — Datenmodell und Rendering werden in einem Zug
> umgestellt, kein inkrementeller Adapter-Pfad. Das heutige Format
> ([DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md)) bleibt ein verlustfrei importierbarer
> Spezialfall (§9).

---

## 1. Motivation

Heute kennt OrgGraph drei feste Begriffe: **Person**, **Organisationseinheit (OE)** und
**Attribut**. Personen/OEs sind Knoten; Attribute sind *Eigenschaften* von Personen,
gerendert als farbige Ringe. Die Hierarchie ist fest aus drei Kantenarten verdrahtet.

Der SBB/SEM-Use-Case verlangt mehr: **Rollen, Teams, Trainings, Projekte** – heute
„Attribute", in Wahrheit **eigene Entitäten**, die mehrere Personen teilen und durch
die man traversieren will. Sie gehören als **Knoten** in den Graphen.

Zielmodell: **Labeled Property Graph (LPG)** – typisierte Knoten mit skalaren
Eigenschaften, typisierte Kanten. Die **Hierarchie wird zur Projektion** über diesen
Graphen, nicht zu seiner Struktur.

**Getroffene Entscheidungen (Stand 2026-06):**
- Reifizierung: *alles Geteilte wird Knoten*, echte Skalare bleiben Eigenschaft (§3).
- Ordnung: über *designierte Hierarchie-Kanten*, BFS-Distanz von den Wurzeln (§6/§7).
- Views: vordefiniert in `env.json`; Start = heutige Personenhierarchie; Footer-Switcher (§5).
- Schema: reist mit den Daten; Views/Mapping in `env.json` (§5/§9).
- Abfrage: deklarative JSON-Selektoren, **kein GraphQL** (§8).
- Zeit: Input = datierte Snapshots → intern Validity-Intervalle; Stichtag *und* Diff;
  stabile IDs vorausgesetzt (§10).

**Getroffene Entscheidungen (Stand 2026-07)** — die vormals offenen Punkte sind entschieden (§14):
- Mehrfach-Eltern: **eine** Knoteninstanz, alle Eltern-Kanten vollwertig gezeichnet (§7.4).
- props-Historie: **Intervall pro props-Stand** — volle Versionierung von Knoten und Kanten (§10).
- Kontext+Rolle: **doppelt reifiziert** — Firma- UND Rolle-Knoten, Bindung als Kanten-prop (§9).
- Schema-Registry: **kuratierte Repo-Datei** `schema/registry.json` (§2.3).
- View-UI: Such-Combo + Shift-Add als Laufzeit-`roots` (heutiges Verhalten bleibt);
  `depth` pro View mit Toolbar-Override; eigene Views speichern = spätere Ausbaustufe (§5).

---

## 2. Kernmodell

```json
{
  "meta":   { "snapshot": "20260618-1500", "source": "…", "crawledAt": "2026-06-18T15:00" },
  "schema": { "nodeTypes": { ... }, "edgeTypes": { ... } },
  "nodes":  [ ... ],
  "edges":  [ ... ]
}
```

`meta` (optional) trägt Provenienz/Snapshot-Datum; gesetzt vom Transform aus dem
Roh-Snapshot (Akquise: §16). Knoten/Kanten dürfen zusätzlich `props.source` führen.

### 2.1 Knoten (`nodes`)

| Feld    | Typ    | Pflicht | Bedeutung |
|---------|--------|---------|-----------|
| `id`    | string | ja      | Eindeutig über **alle** Knoten (gemeinsamer, typ-übergreifender ID-Raum). |
| `type`  | string | ja      | Knotentyp, deklariert in `schema.nodeTypes`. |
| `label` | string | ja      | Anzeigename. |
| `props` | object | nein    | **Skalare Eigenschaften** (§4) – z. B. `email`, `mobil`, `pensum`, `isBasis`. |

### 2.2 Kanten (`edges`)

| Feld     | Typ            | Pflicht | Bedeutung |
|----------|----------------|---------|-----------|
| `type`   | string         | ja      | Kantentyp, deklariert in `schema.edgeTypes`. **Explizit** (nicht mehr aus Endpunkten abgeleitet). |
| `source` | string\|object | ja      | Quell-Knoten-ID (oder Objekt mit `.id`). |
| `target` | string\|object | ja      | Ziel-Knoten-ID. |
| `props`  | object         | nein    | Kanten-Eigenschaften (z. B. `rolle`, `validFrom`, `validTo`). |

### 2.3 Schema (`schema`) — kanonische Typ-Registry, aus realen SEM/SBB-Daten abgeleitet

Das Schema ist die **kanonische Typ-Registry**: zentral vorgegeben, *einzige Quelle der
Wahrheit*. Provider/Crawler erfinden keine Typen, sondern **mappen hinein**; neue Typen
entstehen nur über das Analyse-Gate der Akquise (CRAWLING-SPEC §3). Ein Dataset-`schema`
ist eine **Teilmenge** der Registry.

**Pflege (entschieden):** Die Registry lebt als **kuratierte, versionierte Repo-Datei**
`schema/registry.json`. Crawler und Builder-Toolkit importieren sie; das Dataset-`schema`
erzeugt der Builder als Teilmenge der tatsächlich verwendeten Typen. Neue Typen entstehen
ausschliesslich über Analyse-Gate + Commit an der Registry — kein Harvester generiert
eigenmächtig Typen.

```json
"schema": {
  "nodeTypes": {
    "Person":   {}, "OE": {}, "AufbauOrg": {}, "Firma": {},
    "Rolle":    {}, "Team": {}, "Training": {}, "Projekt": {}
  },
  "edgeTypes": {
    "unterstellt": { "from": "OE",     "to": "OE",        "hierarchy": true },
    "mitgliedIn":  { "from": "Person", "to": "OE",        "hierarchy": true },
    "berichtetAn": { "from": "Person", "to": "Person",    "hierarchy": true },
    "gehoertZu":   { "from": "Person", "to": "AufbauOrg" },
    "hatRolle":    { "from": "Person", "to": "Rolle" },
    "arbeitetBei": { "from": "Person", "to": "Firma" },
    "imTeam":      { "from": "Person", "to": "Team" },
    "besuchte":    { "from": "Person", "to": "Training" },
    "arbeitetAn":  { "from": "Person", "to": "Projekt" }
  }
}
```

`from`/`to` = erlaubte Endpunkt-Typen (`"*"` = beliebig); `hierarchy:true` = Hierarchie-Kante (§6).

---

## 3. Reifizierungsregel — Knoten oder Eigenschaft?

**Alles Geteilte wird Knoten.** Kriterium:

> Eigene Identität / von mehreren geteilt / traversierbar → **Knoten** (`id`+`type`),
> verbunden über Kante. Einzelwert, genau einer Entität, nie Gruppen-/Traversal-Ziel →
> **skalare Eigenschaft** in `props`.

**Empirisch belegt an SBB-GD** (drei Attribut-Dateien, drei Ausgänge):

| Attribut-Datei        | Wert-Beispiel       | Ergebnis            | Warum |
|-----------------------|---------------------|---------------------|-------|
| `AufbauOrg`           | `IT-MIK-CEN2` (geteilt) | **Knoten** `AufbauOrg` + `gehoertZu` | viele teilen den Code |
| `Beschaeftigungsgrad` | `99`, `100` (numerisch) | **Eigenschaft** `props.pensum` | Skalar pro Person |
| `Mobilnummer`         | `+41 79 …` (unique) | **Eigenschaft** `props.mobil` | unique, nie Traversal-Ziel |

**Import-Heuristik** (Default; per `ATTRIBUTE_TYPES` übersteuerbar, §9):

> Wert **numerisch** ODER **unique pro Person** → Eigenschaft.
> Wert **kategorisch/geteilt** → Knoten + Kante (Dateiname → Kantentyp/Kontext, Wert →
> dedupliziertes Ziel). Im Zweifel: heutiges Ring-Verhalten behalten → nichts geht verloren.

---

## 4. Eigenschaften (`props`)

Skalare Werte, nicht traversierbar, verlustfrei gespeichert. Reservierte mit Wirkung:

| Property  | Knotentyp | Wirkung |
|-----------|-----------|---------|
| `isBasis` | Person    | Blatt-Knoten; bei Management-Filter ausgeblendet (wie heute). |
| `email`   | Person    | Zweit-Identifier beim Attribut-Import (§9). |
| `mobil`, `pensum`, … | Person | aus skalaren Attribut-Dateien; Anzeige in Tooltip/Label. |

---

## 5. Views / Projektionen

Eine **Sicht** = Selektor, der aus dem Gesamtgraphen einen darstellbaren Teilgraphen
mit Ordnung erzeugt:

```
View = (roots, edgeTypes, hierarchyEdges, visibleNodeTypes, render, depth?, time?)
```

| Feld               | Bedeutung |
|--------------------|-----------|
| `roots`            | Wurzel-Knoten-IDs (Ordnung 0). |
| `edgeTypes`        | In dieser Sicht traversierte/gezeigte Kantentypen. |
| `hierarchyEdges`   | Teilmenge, die den Baum aufspannt (Ordnung; §7). |
| `visibleNodeTypes` | Sichtbare Knotentypen (`"*"` = alle erreichbaren). |
| `render`           | Pro Typ: `node` / `ring` / `hidden` (§11). |
| `depth`            | Optional: Start-Tiefenbegrenzung dieser View (Default, s. u.). |
| `time`             | Optional: Zeitmodus (§10) – `asOf` Datum oder `diff` [T1, T2]. |

Views liegen in **`env.json`** (dependency-free, env-getrieben). Beispiel:

```json
"VIEWS": {
  "Personenhierarchie": {
    "roots": ["__auto__"],
    "edgeTypes": ["berichtetAn", "mitgliedIn", "unterstellt", "hatRolle"],
    "hierarchyEdges": ["berichtetAn", "mitgliedIn", "unterstellt"],
    "visibleNodeTypes": ["Person", "OE"],
    "render": { "Rolle": "ring", "Team": "ring", "Training": "ring", "Projekt": "ring" }
  },
  "Projekt-Sicht": {
    "roots": ["proj-zi"],
    "edgeTypes": ["arbeitetAn", "hatRolle", "mitgliedIn"],
    "hierarchyEdges": ["arbeitetAn"],
    "visibleNodeTypes": ["Projekt", "Person", "OE"],
    "render": { "Rolle": "ring" }
  }
}
```

- **Start-View = „Personenhierarchie"** bildet die heutige aktive Darstellung 1:1 ab.
  `roots:["__auto__"]` = Knoten ohne eingehende Hierarchie-Kante (heutige Wurzel-Logik).
- **Footer-Switcher** wählt zwischen Views (analog zum Mandanten-Switcher).
- Fehlt `VIEWS`, gilt die Personenhierarchie als impliziter Default.

### 5.1 Laufzeit-Übersteuerung (entschieden)

- **`roots` zur Laufzeit — heutige Mechanik bleibt:** Die Such-Combo wählt einen Knoten
  als Root (ersetzt die View-`roots`); **Shift-Klick / Shift-Enter** fügt den Treffer als
  weiteren Root zur Multi-Root-Liste hinzu (heutiges `setSingleRoot`/`addRoot`-Verhalten,
  `src/sections/10-combo.js`). Die Suche läuft dabei über alle sichtbaren Knotentypen der
  aktiven View, nicht mehr nur Personen/OEs. Die View-**Definition** bleibt unverändert
  (temporäre Übersteuerung); View-Wechsel setzt auf die definierten `roots` zurück.
- **`depth`:** Der optionale View-Wert ist der Startwert; der bestehende Toolbar-Regler
  übersteuert zur Laufzeit. View-Wechsel stellt den View-Default wieder her.
- **Eigene Views speichern = spätere Ausbaustufe (v2):** In der ersten Ausbaustufe kommen
  Views ausschliesslich aus `env.json` (bzw. reisen mit den Daten). Das Sichern der
  aktuellen Projektion als benannte View im Profil-Store ist als v2 vorgemerkt.

---

## 6. Hierarchie-Kanten (designiert)

Die Ordnung wird über ein **designiertes Set von Hierarchie-Kantentypen** definiert,
nicht über kürzeste Pfade im Gesamtgraphen.

- Hierarchie-Kante = Schema `hierarchy:true` **oder** View-`hierarchyEdges` (View überschreibt).
- Nur diese Kanten spannen den Baum auf und bestimmen die Ordnung.
- Übrige `edgeTypes` der View = **Quer-Verbindungen**, ohne Ordnungseffekt.

---

## 7. Ordnung / Tiefe — exakte Regel

Gegeben `roots` und `hierarchyEdges`:

1. **Order 0:** alle `roots`.
2. **BFS** entlang *ausschliesslich* der `hierarchyEdges` (Richtung beachten).
3. `order(n)` = **kürzeste** Distanz von der nächsten Wurzel entlang Hierarchie-Kanten.
4. **Mehrfach-Eltern (entschieden):** Der Knoten existiert genau **einmal** (keine
   Duplikation — Identität, Suche, Pseudonymisierung und Diff hängen an stabilen IDs).
   Die flachste Hierarchie-Kante bestimmt die Ordnung; **alle** Eltern-Kanten werden als
   vollwertige Verbinder gezeichnet (kein Degradieren zur Quer-Verbindung). Zielbild:
   Die gerichteten Filter erzeugen möglichst baumnahe Subgraphen; die sichtbare
   Mehrfach-Kante ist die legitime Ausnahme in diesen Fällen.
5. **Zyklen:** sollen laut Datenvertrag nicht auftreten; BFS nimmt flachste Distanz, ignoriert Rück-Kanten.
6. **Nicht erreichbar:** nur als Quer-Link sichtbarer Knoten in den Baum aufgenommen.

Setzt man `hierarchyEdges` = {unterstellt, mitgliedIn, berichtetAn}, ergibt sich exakt
der heutige Org-Baum.

---

## 8. Abfrage / Sichten — Standardwahl (kein GraphQL)

**GraphQL ist bewusst nicht das Mittel der Wahl.** Es ist keine Graph-Traversal-,
sondern eine getypte API-Fetch-Sprache (baumförmig, Server + Resolver nötig) und kann
Pfad-/Tiefen-/„alle verbundenen"-Abfragen — genau den View-Kern — nicht ausdrücken. Für
eine dependency-free, single-file, offline (IndexedDB) App wäre es ein Fremdkörper.

- **Jetzt:** Views = **deklarative JSON-Selektoren** (§5). Null Dependency, deckt
  vordefinierte Sichten vollständig ab.
- **Später (falls Ad-hoc-Abfragen):** ein **winziges Cypher/GQL-Subset**. Der passende
  Standard für Property-Graphen ist **GQL/openCypher** (ISO/IEC 39075:2024), nicht GraphQL.
- GraphQL-SDL höchstens als Inspiration für die Schema-Notation — JSON bleibt konsistenter.

---

## 9. Rückwärtskompatibilität & Migration

Das heutige Format ist importierbarer Spezialfall:

| Alt                              | Neu |
|----------------------------------|-----|
| `persons[]`                      | `nodes` `type:"Person"`, `email`/`isBasis` → `props` |
| `orgs[]`                         | `nodes` `type:"OE"` |
| Link P→P / P→OE / OE→OE          | `edge` `berichtetAn` / `mitgliedIn` / `unterstellt` (hierarchy) |
| Attribut-Datei, Kategorie `K`, geteilter Wert | Knoten `type` aus Mapping, `label:wert` (dedup) + Kante; Render `ring` |
| Attribut mit numerischem/unique Wert | `props`-Eigenschaft (kein Knoten) |
| „Kontext+Rolle"-Datei (z. B. `AKROS`) | **Doppelt reifiziert:** Firma-Knoten (`arbeitetBei`) UND Rolle-Knoten (`hatRolle`); Bindung Rolle↔Firma als Kanten-`props.kontext` (s. u.) |

**`ATTRIBUTE_TYPES`** in `env.json` übersteuert die Heuristik pro Kategorie:

```json
"ATTRIBUTE_TYPES": {
  "Mobilnummer":        { "kind": "property", "prop": "mobil" },
  "Beschaeftigungsgrad":{ "kind": "property", "prop": "pensum" },
  "AufbauOrg":          { "kind": "node", "nodeType": "AufbauOrg", "edgeType": "gehoertZu" },
  "ERZ Rollen Rom":     { "kind": "node", "nodeType": "Rolle", "edgeType": "hatRolle" },
  "AKROS":              { "kind": "contextRole", "contextType": "Firma", "contextLabel": "AKROS",
                          "contextEdge": "arbeitetBei", "roleType": "Rolle", "roleEdge": "hatRolle" }
}
```

**„Kontext+Rolle" — generische Regel (entschieden):** Solche Dateien beschreiben eine
**ternäre Relation** (Person × Rolle × Firma). Sie wird **doppelt reifiziert**:

- Kontext → Knoten `Firma` (dedupliziert), Kante `Person → arbeitetBei → Firma`;
- Wert → Knoten `Rolle` (dedupliziert), Kante `Person → hatRolle → Rolle` mit
  **`props.kontext` = Firma-Label** als Bindung der ternären Relation.

Damit sind beide Richtungen abfragbar: *„alle Personen mit Rolle X"* (Traversal über den
Rolle-Knoten, firmenübergreifend) und *„wer arbeitet in welcher Rolle bei Firma Y"*
(Traversal über den Firma-Knoten bzw. Filter auf `props.kontext`).

Die Kantentyp-Ableitung aus Endpunkten läuft **nur** im Import-Adapter, nicht im
Kernmodell. Bestehende `data.json` + Attribute funktionieren unverändert.

---

## 10. Zeitmodell — Snapshots → Validity-Intervalle

**Input = mehrere datierte Snapshots** (wie `data/HRM/sources/2025…`–`2026…`); jeder
Snapshot ist ein Vollstand. **Internes Modell = Validity-Intervalle**: der Import difft
aufeinanderfolgende Snapshots und vergibt an Knoten und Kanten `validFrom`/`validTo`
(`null` = offen/aktuell).

- **Stabile IDs vorausgesetzt** (SBB `P00…` sind stabil): Diff = simpler ID-Vergleich,
  kein Fuzzy-Matching nötig.
- **Diff-Regel:** in Snapshot _t_ vorhanden, in _t-1_ nicht → `validFrom = datum(t)`;
  in _t-1_ vorhanden, in _t_ nicht → `validTo = datum(t)`.
- **props-Änderung = neues Intervall (entschieden):** Ändert sich ein props-Stand
  zwischen Snapshots, wird die bestehende **Version** geschlossen (`validTo = datum(t)`)
  und eine neue Version mit dem neuen props-Stand eröffnet (`validFrom = datum(t)`).
  Es gilt volle Eigenschafts-Historie (z. B. Pensum-Verlauf).
  - **Versionsmodell:** `nodes` darf mehrere Einträge mit **gleicher `id`** und
    **disjunkten** Validity-Intervallen enthalten; die `id` bleibt der stabile
    Identitätsanker über alle Versionen. Gleiches gilt für Kanten (Versionsschlüssel
    `type`+`source`+`target`).
  - **`asOf`** wählt pro `id` die zu T gültige Version; **`diff`** vergleicht die zu T1
    und T2 gültigen Versionen und markiert abweichende props als „geändert".
- **Zwei gleichwertige Zeitmodi** der View:
  - **`asOf` (Stichtag):** Datums-Slider; gerendert wird, was zu T gültig ist
    (`validFrom ≤ T < validTo`).
  - **`diff` (T1→T2):** Hervorhebung **neu** / **weggefallen** / **geändert** — wer kam,
    wer ging, welche OE sich auflöste.
- **Orthogonal zu Mandanten:** Profil = Tenant (eigener IndexedDB-Store), Snapshot = Zeit.
  Zeitstände eines Mandanten liegen in dessen Store.

```json
{ "id": "p-1", "type": "Person", "label": "Anna Müller",
  "props": { "email": "anna@…" }, "validFrom": "2025-08-28", "validTo": null }
```

---

## 11. Render-Modi

| Modus    | Wirkung |
|----------|---------|
| `node`   | Eigenständiger Graph-Knoten mit eigenen Kanten (Default Person/OE). |
| `ring`   | Verbundener Knoten als Ring/Badge am Quellknoten — **die heutige Attribut-Darstellung**, jetzt als Render-Option eines Kantentyps. |
| `hidden` | Im Graphen ausgeblendet (nur Filter/Suche). |

---

## 12. Auswirkungen auf bestehende Features

| Feature                  | Anpassung |
|--------------------------|-----------|
| Legende (OE/Attribute)   | Verallgemeinern auf Knotentypen + per-Typ-Gruppen; Attribut-Legende = ring-gerenderte Typen. |
| Filter / Suche           | Über beliebige Knotentypen. |
| Management-Filter        | Bleibt: `props.isBasis`. |
| OE-Sichtbarkeit-Toggle   | Wird generisch: Knotentyp-Sichtbarkeit. |
| Pseudonymisierung        | Pro Knotentyp konfigurierbar (heute fix auf Person). |
| Mandanten (IndexedDB)    | Unverändert; schema/nodes/edges/views liegen im Profil-Store. |
| Toolbar Tiefe/Richtung   | Pro View angewandt; zusätzlich Zeit-Slider (§10). |

---

## 13. Performance / Skalierung

SEM hat 53k Personen / 114k Kanten. **Nie der ganze Graph** wird gerendert — eine View
reduziert auf roots + Tiefenbegrenzung + sichtbare Typen + Zeitschnitt. Force-Layout
läuft nur auf dem projizierten Teilgraphen.

---

## 14. Entschiedene Punkte (vormals offen, Stand 2026-07-02)

1. **Selektor-/View-UI:** Laufzeit-`roots` über die bestehende Such-Combo inkl.
   Shift-Add (Multi-Root) — heutiges Verhalten bleibt; `depth` als View-Default mit
   Toolbar-Override; eigene Views speichern = spätere Ausbaustufe (v2). → §5.1
2. **Mehrfach-Eltern:** eine Knoteninstanz, alle Eltern-Kanten als vollwertige
   Verbinder; flachste Hierarchie-Kante bestimmt die Ordnung. → §7.4
3. **props-Änderung über Zeit:** Intervall pro props-Stand (volle Versionierung von
   Knoten und Kanten); Eigenschafts-Historie ist gewollt. → §10
4. **„Kontext+Rolle"-Dateien:** doppelt reifiziert (Firma- und Rolle-Knoten), Bindung
   der ternären Relation als Kanten-`props.kontext`; `ATTRIBUTE_TYPES`-Kind
   `contextRole`. → §9
5. **Schema-Pflege:** kuratierte, versionierte Repo-Datei `schema/registry.json`;
   Builder erzeugt das Dataset-`schema` als Teilmenge; neue Typen nur via
   Analyse-Gate + Commit. → §2.3
6. **Umsetzungsstrategie:** Big Bang — App-Kern (Datenmodell + Rendering) wird in
   einem Zug auf das Graph-Modell umgestellt, kein inkrementeller Adapter-Pfad.

---

## 15. Vollständiges Mini-Beispiel

```json
{
  "schema": {
    "nodeTypes": { "Person": {}, "OE": {}, "Rolle": {}, "Projekt": {} },
    "edgeTypes": {
      "unterstellt": { "from": "OE", "to": "OE", "hierarchy": true },
      "mitgliedIn":  { "from": "Person", "to": "OE", "hierarchy": true },
      "berichtetAn": { "from": "Person", "to": "Person", "hierarchy": true },
      "hatRolle":    { "from": "Person", "to": "Rolle" },
      "arbeitetAn":  { "from": "Person", "to": "Projekt" }
    }
  },
  "nodes": [
    { "id": "oe-1", "type": "OE",      "label": "Bundeskanzlei" },
    { "id": "p-1",  "type": "Person",  "label": "Anna Müller",    "props": { "email": "anna@example.ch" } },
    { "id": "p-2",  "type": "Person",  "label": "Max Mustermann", "props": { "email": "max@example.ch", "isBasis": true } },
    { "id": "r-se", "type": "Rolle",   "label": "Software Engineer" },
    { "id": "pr-zi","type": "Projekt", "label": "ZI" }
  ],
  "edges": [
    { "type": "mitgliedIn",  "source": "p-1", "target": "oe-1" },
    { "type": "mitgliedIn",  "source": "p-2", "target": "oe-1" },
    { "type": "berichtetAn", "source": "p-1", "target": "p-2" },
    { "type": "hatRolle",    "source": "p-2", "target": "r-se" },
    { "type": "arbeitetAn",  "source": "p-2", "target": "pr-zi" }
  ]
}
```

Personenhierarchie-View (`render:{Rolle:"ring"}`): `oe-1` Ordnung 0, Anna & Max Ordnung 1,
Max trägt einen „Software Engineer"-Ring. Projekt-View (`roots:["pr-zi"]`,
`hierarchyEdges:["arbeitetAn"]`): `pr-zi` Ordnung 0, Max Ordnung 1.

---

## 16. Akquise & Provenienz (→ CRAWLING-SPEC.md)

Dieses Dokument beschreibt das **Ziel**; die **Gewinnung** ist in
[CRAWLING-SPEC.md](CRAWLING-SPEC.md) spezifiziert. Sie ist bewusst **einstufig**: jeder
Provider-Crawler erzeugt **direkt** dieses Modell — kein Roh-Zwischenformat (es gäbe ohnehin
kein providerübergreifendes gemeinsames Rohformat; das gemeinsame Format ist die Zielstruktur).

```
Quelle ──Crawl (Chrome-Console, nutzt kanonische Registry §2.3 + Builder)──▶ Graph-Snapshot
       ──optional: generischer Down-Converter──▶ Legacy data.json (heutige App)
```

- **Kanonische Typen (§2.3)** werden providerübergreifend einheitlich verwendet; der Crawl
  startet mit einer **Analyse-Phase**, die noch *untypisierte* Knoten/Kanten meldet
  (CRAWLING-SPEC §3), bevor typisiert voll-gecrawlt wird.
- Der Crawler setzt `meta` (Quelle, `snapshot`-Datum `YYYYMMDD-HHMM`, Crawl-Zeit) und
  vergibt **stabile IDs** (Quell-PK/E-Mail) — Voraussetzung fürs Diffen.
- Snapshots liegen historisiert unter `data/<tenant>/sources/`; das Diffen zu
  Validity-Intervallen (§10) läuft **direkt auf den Ziel-Snapshots**.
- **Reifizierung (§3) / `ATTRIBUTE_TYPES` (§9)** wendet der Crawler beim Erzeugen an;
  Korrekturen erfolgen als „Gerade ziehen" am Ziel-File.
