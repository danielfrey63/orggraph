# PRD — OrgGraph 2.0: Typisierter Property-Graph

> **Status: Verbindlich (2026-07-02).** Dieses PRD ist die massgebliche Produkt- und Anforderungsspezifikation für den Umbau von OrgGraph auf einen typisierten Property-Graphen. Es ersetzt und integriert die Vorgänger-Dokumente `GRAPH-MODEL-SPEC.md` (Datenmodell) und `CRAWLING-SPEC.md` (Akquise). Das Alt-Format bleibt in [DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md) dokumentiert und ist nur noch Input des Einmal-Migrationsskripts (§10).

---

## 1. Produktübersicht

### 1.1 Vision

OrgGraph visualisiert Organisations-Wissen als interaktiven Graphen — offline, als einzelne HTML-Datei, ohne Server und ohne Laufzeit-Dependencies ausser D3. Heute kennt die App drei fest verdrahtete Begriffe (Person, Organisationseinheit, Attribut); künftig arbeitet sie auf einem **generischen, typisierten Property-Graphen (Labeled Property Graph, LPG)**: typisierte Knoten mit skalaren Eigenschaften, typisierte Kanten, Zeitdimension über Versionierung. Die Org-Hierarchie ist dann nur noch eine **Projektion (View)** über diesen Graphen — eine von beliebig vielen.

### 1.2 Anlass und Zielnutzer

Der SBB/SEM-Use-Case verlangt Entitäten, die heute als «Attribute» (farbige Ringe) abgebildet werden, in Wahrheit aber eigene, geteilte, traversierbare Objekte sind: Rollen, Teams, Trainings, Projekte, Gremien, Firmen, Standorte. Zielnutzer sind Analysten und Führungskräfte, die Organisationsdaten aus verschiedenen Quellen (AdminDir, Confluence, HR-Exporte) explorieren, vergleichen und über die Zeit verfolgen.

### 1.3 Leitentscheidungen

| # | Entscheidung | Datum |
|---|--------------|-------|
| E1 | Zielmodell = LPG; Reifizierung: alles Geteilte wird Knoten, echte Skalare bleiben `props` | 2026-06 |
| E2 | Hierarchie = Projektion; Ordnung = BFS-Distanz entlang designierter Hierarchie-Kanten | 2026-06 |
| E3 | Abfrage über deklarative JSON-Selektoren (Views), bewusst **kein GraphQL**; später allenfalls kleines GQL/openCypher-Subset | 2026-06 |
| E4 | Zeit: datierte Voll-Snapshots als Input, intern Validity-Intervalle; Modi `asOf` und `diff` | 2026-06 |
| E5 | Mehrfach-Eltern: eine Knoteninstanz, alle Eltern-Kanten vollwertig gezeichnet, flachste Hierarchie-Kante bestimmt die Ordnung | 2026-07 |
| E6 | **Volle Versionierung** von Knoten, Kanten und Properties: Intervall pro props-Stand (§5) | 2026-07 |
| E7 | Kontext+Rolle-Relationen doppelt reifiziert; Bindung der ternären Relation als **typisierte Knoten-Referenz-Property** auf der Kante (§4.5) | 2026-07 |
| E8 | Typ-Registry = kuratierte Repo-Datei `schema/registry.json` | 2026-07 |
| E9 | Umsetzung als **Big Bang**: Datenmodell und Rendering in einem Zug, kein Adapter-Pfad | 2026-07 |
| E10 | Migration Alt→Neu über ein **separates Einmal-Skript**, kein Legacy-Import in der App (App war nie distribuiert) | 2026-07 |
| E11 | **Knotentypen sind generisch**: Engine typ-agnostisch, Typ-Verhalten deklarativ über Registry-Capabilities (§4.2) | 2026-07 |
| E12 | Bestehende UI-Elemente, Algorithmen und Konfigurationen werden übernommen; Layout-Algorithmen bleiben identisch (§9) | 2026-07 |
| E13 | Darstellung (Farben, Icons) ist keine Typ-Konfiguration: nicht in der Registry, nicht in env.json — die Farbstrategie folgt deterministisch dem Render-Modus der View (§4.2, FR-4.2a) | 2026-07 |
| E14 | Alle konkreten Typ-, Kanten- und View-Nennungen im PRD sind **Illustrationen**, kein Implementierungsauftrag; verbindlich ist allein, was über Phase A + Gate in die Registry gelangt (FR-6.1a) | 2026-07 |
| E15 | Kanten-Identität = `type`+`source`+`target` **plus** die im Schema deklarierten `identityProps` (z. B. `kontext`) — sonst kollidieren gleichzeitige gleiche Rollen bei verschiedenen Firmen (FR-5.2) | 2026-07 |
| E16 | Umsetzungsweg: vollständige Neuerstellung auf separatem Branch, als Goal-Loop gegen die Akzeptanzkriterien (§13) getrieben; Tech-Stack unverändert (§1.5) | 2026-07 |
| E17 | Kantenrichtung: Kanten zeigen **vom Untergeordneten zum Übergeordneten** (Namen lesen sich als Satz); Baum-Abstieg traversiert gegen die Kantenrichtung; Legacy-Richtungen werden bei der Migration normalisiert (FR-7.2a) | 2026-07 |
| E18 | **Hierarchie ist ausschliesslich ein View-Konzept**: kein `hierarchy`-Flag in der Registry; die `hierarchyEdges` der View sind die einzige Quelle. Fehlt `VIEWS`, werden alle Knoten ohne Ordnung dargestellt (§7) | 2026-07 |

### 1.4 Nicht-Ziele

- Kein Server, keine Datenbank ausser IndexedDB im Browser, keine Build-Dependencies zur Laufzeit.
- Kein GraphQL und keine Ad-hoc-Query-Sprache in v1.
- Kein Legacy-Import (altes `data.json` / Attribut-TSV) in der App — das leistet einmalig das Migrationsskript (§10).
- Kein Speichern benutzerdefinierter Views in v1 (vorgemerkt für v2, §12).

### 1.5 Umsetzungsweg

Big Bang (E9) ist die **Release-Strategie** — es gibt keinen Adapter-Pfad und keinen Parallelbetrieb in `main`. Der Weg dorthin ist eine **vollständige Neuerstellung auf einem separaten Branch** (E16): gleicher Tech-Stack wie heute (dependency-freies Vanilla JS + D3, Sections-Single-File-Build, IndexedDB), getrieben als **Goal-Loop** — implementieren, gegen die Akzeptanzkriterien (§13) und das Übernahme-Inventar (§9) prüfen, nachbessern — bis alle Kriterien erfüllt sind; erst dann wird der Branch nach `main` übernommen.

---

## 2. Begriffe

| Begriff | Bedeutung |
|---------|-----------|
| Knoten / Kante | Typisierte Entität bzw. typisierte gerichtete Beziehung im Graphen. |
| Registry | Kanonische, kuratierte Typ-Deklaration (`schema/registry.json`); einzige Quelle der Wahrheit für Typen. |
| Snapshot | Datierter Vollstand eines Crawls innerhalb eines deklarierten Scopes. |
| Version | Datensatz eines Knotens/einer Kante mit einem props-Stand und einem Validity-Intervall. |
| View | Deklarativer Selektor, der aus dem Gesamtgraphen einen darstellbaren, geordneten Teilgraphen projiziert. |
| Tenant / Profil | Mandant mit eigenem IndexedDB-Object-Store; enthält Graph, Snapshots-Registry und Konfiguration. |

---

## 3. Datenformat (Snapshot)

Ein Snapshot ist eine JSON-Datei mit vier Blöcken:

```json
{
  "meta":   { "source": "…", "crawledAt": "2026-06-18T15:00", "snapshot": "20260618-1500", "registryVersion": "…", "scope": { … } },
  "schema": { "nodeTypes": { … }, "edgeTypes": { … } },
  "nodes":  [ … ],
  "edges":  [ … ]
}
```

**FR-3.1** `meta` trägt Provenienz: Quelle, Crawl-Zeitpunkt, Snapshot-Stempel `YYYYMMDD-HHMM`, die verwendete Registry-Version (FR-6.1b) und den Scope (§6.2). Knoten/Kanten dürfen zusätzlich `props.source` führen.

**FR-3.2** Knoten: `id` (eindeutig über alle Knoten, typ-übergreifender ID-Raum), `type` (in `schema.nodeTypes` deklariert), `label` (Anzeigename), optional `props` (skalare Eigenschaften).

**FR-3.3** Kanten: `type` (explizit, in `schema.edgeTypes` deklariert — nie aus Endpunkten abgeleitet), `source`, `target` (Knoten-IDs), optional `props`.

**FR-3.4** Das Dataset-`schema` ist eine **Teilmenge der Registry**: nur die tatsächlich verwendeten Typen. `edgeTypes` deklarieren `from`/`to` (erlaubte Endpunkt-Typen, `"*"` = beliebig). Ein Hierarchie-Flag gibt es bewusst nicht — Hierarchie ist ein reines View-Konzept (E18).

**FR-3.5** IDs sind **stabil** (Quell-PK, URL-ID, E-Mail; notfalls `slug(label)` mit `props.idSource='name'`) — Voraussetzung für Diff und Versionierung.

**FR-3.6** Das Snapshot-Format ist maschinenprüfbar definiert in [`schema/snapshot.schema.json`](schema/snapshot.schema.json) (inkl. `meta.scope` und Versionsfeldern); die Import-Validierung (FR-6.8) prüft dagegen. Views sind analog in [`schema/view.schema.json`](schema/view.schema.json) definiert.

---

## 4. Typsystem

### 4.1 Kanonische Registry

**FR-4.1** Die Registry lebt als kuratierte, versionierte Repo-Datei `schema/registry.json`. Crawler und Builder importieren sie und mappen hinein; neue Typen entstehen ausschliesslich über das Analyse-Gate der Akquise (§6) plus Commit. Kein Harvester erfindet eigenmächtig Typen. Das Registry-**Format** ist verbindlich definiert als JSON Schema in [`schema/registry.schema.json`](schema/registry.schema.json); ein illustratives Beispiel (E14) liegt in [`schema/registry.example.json`](schema/registry.example.json). Die Datei `schema/registry.json` existiert von Anfang an, startet aber **leer** (Version `0`, keine Typen) und wird ausschliesslich über Gate-Commits gefüllt (Registry-Bootstrap FR-6.1a).

> **Illustration, nicht normativ (E14).** Die folgenden Typenlisten zeigen, was aus den bisherigen SBB/SEM-Analysen voraussichtlich hervorgeht — sie dienen in diesem PRD durchgehend als Beispielmaterial und sind **kein Implementierungsauftrag**. Es gibt keine im Code oder im PRD fixierte Typenliste; verbindlich ist ausschliesslich der jeweilige Stand von `schema/registry.json`, der über Phase A + Gate entsteht und wächst (FR-6.1a).

Beispiel-Knotentypen: `Person`, `OE`, `AufbauOrg`, `Rolle`, `Team`, `Gremium`, `Training`, `Projekt`, `Firma`, `Standort`, `Gebäude`.

Beispiel-Kantentypen:

| Typ | from → to |
|-----|-----------|
| `unterstellt` | OE → OE |
| `mitgliedIn` | Person → OE |
| `berichtetAn` | Person → Person |
| `leitet` | Person → OE |
| `vertritt` | Person → OE |
| `gehoertZu` | Person → AufbauOrg |
| `hatRolle` | Person → Rolle (`props.kontext` referenziert den Firma-Knoten, §4.5) |
| `arbeitetBei` | Person → Firma |
| `imTeam` | Person → Team |
| `imGremium` | Person → Gremium |
| `besuchte` | Person → Training |
| `arbeitetAn` | Person → Projekt |
| `amStandort` | Person/OE → Standort |
| `imGebäude` | Person → Gebäude |

Ein Hierarchie-Flag gibt es in der Registry bewusst nicht (E18): Der Graph ist gerichtet, die Richtungs-Konvention (FR-7.2a) gilt pro Kantentyp — aber **welche** Kantentypen einen Baum aufspannen, bestimmt allein die View über `hierarchyEdges` (§7).

### 4.2 Generische Knotentypen (Capabilities)

**FR-4.2** Die App-Engine ist **vollständig typ-agnostisch**: Im Applikationscode kommt kein Typname (`Person`, `OE`, …) vor. Alles typ-spezifische Verhalten wird deklarativ über **Capabilities** am Registry-Eintrag konfiguriert. Ein neuer Knotentyp ist damit reine Datenpflege — kein Code.

Beispiel (illustrativ, E14):

```json
"nodeTypes": {
  "Person": {
    "labelProp": "label",
    "identifiers": ["id", "props.email"],
    "leafProp": "isBasis",
    "pseudonymize": { "pool": "names" }
  },
  "OE": {
    "pseudonymize": { "pool": "orgUnits", "byLevel": true }
  },
  "Rolle": {}
}
```

| Capability | Ersetzt heutiges Hardcoding | Wirkung |
|------------|------------------------------|---------|
| `labelProp` | `label`-Feld fix | Welche Eigenschaft als Anzeigename dient. |
| `identifiers` | Fuzzy-Suche über `id`/`email`/`label` fix auf Personen | Suchbare/matchbare Identifikatoren des Typs (Suche, Import-Abgleich). |
| `leafProp` | Management-Filter über `isBasis` fix auf Personen | Boolesche Eigenschaft, die Blatt-Knoten markiert; der Blatt-Filter der Toolbar blendet sie typunabhängig aus. |
| `pseudonymize` | `names[]` (Person) / `organizationalUnits{level}[]` (OE) fix | Pseudonym-Pool pro Typ, optional level-abhängig; Typen ohne Capability werden nicht pseudonymisiert. |

**FR-4.2a Darstellung ist keine Typ-Konfiguration (E13).** Farben und Icons gehören weder in die Registry (sie ist der providerübergreifende Datenvertrag, keine Präsentationsschicht) noch in `env.json`. Die Farbstrategie folgt deterministisch dem **Render-Modus der View**: `node` → Level-Verlauf nach BFS-Ordnung (heutiges `getNodeFillByLevel`), `cluster` → Hash-Farbe aus der ID (heutiges `colorForOrg`), `ring` → quantisierter Kategorie-Hue aus dem Typnamen mit Shift pro Knoten (heutige Attribut-Farben). Die bestehenden Farb-Algorithmen bleiben unverändert; es gibt nichts zu konfigurieren. Tooltips und Legenden verwenden den Typnamen aus der Registry statt fester Emojis oder Icons.

**FR-4.3** Render-Modi sind View-Sache (§7), nicht Typ-Sache: derselbe Typ kann in einer View `node`, in einer anderen `ring` sein.

### 4.3 Reifizierungsregel

**FR-4.4** Eigene Identität / von mehreren geteilt / traversierbar → **Knoten** (`id`+`type`), verbunden über Kante. Einzelwert, genau einer Entität, nie Gruppen- oder Traversal-Ziel → **skalare Eigenschaft** in `props`. Empirisch belegt an SBB-GD: AufbauOrg-Code (geteilt) → Knoten; Beschäftigungsgrad (numerisch) → `props.pensum`; Mobilnummer (unique) → `props.mobil`.

### 4.4 Eigenschaften (`props`)

**FR-4.5** Skalare Werte, verlustfrei gespeichert, versioniert (§5). Wirkung entfalten sie nur über Capabilities (`leafProp`, `identifiers`, `labelProp`) oder Anzeige (Tooltip, Label-Modus «attributes»). Einzige Ausnahme vom Skalar-Prinzip: im Schema deklarierte Knoten-Referenz-Properties (FR-4.7).

### 4.5 Ternäre Relationen (Kontext+Rolle) und Knoten-Referenz-Properties

**FR-4.6** Relationen der Form «Person × Rolle × Firma» werden **doppelt reifiziert**: Firma-Knoten (dedupliziert) über `arbeitetBei`, Rolle-Knoten (dedupliziert) über `hatRolle`, und die Bindung liegt als **Knoten-Referenz-Property** `props.kontext` (Wert = **ID** des Firma-Knotens, nicht dessen Label) auf der `hatRolle`-Kante. Damit sind beide Richtungen abfragbar: «alle Personen mit Rolle X» (Traversal über den Rolle-Knoten, firmenübergreifend) und «wer arbeitet in welcher Rolle bei Firma Y» (Traversal über den Firma-Knoten bzw. Filter auf die Referenz).

**FR-4.7 Knoten-Referenz-Properties (generischer Mechanismus).** Eine Kanten- oder Knoten-Property kann im Schema als **Referenz auf einen Knotentyp** deklariert werden, z. B. `"hatRolle": { "from": "Person", "to": "Rolle", "props": { "kontext": { "ref": "Firma", "implies": "arbeitetBei" } } }` (illustrativ, E14). Der Wert ist dann eine Knoten-ID; der Import validiert Existenz und Typ des Ziels (FR-6.8). Die Engine behandelt Referenz-Properties als auflösbar: Anzeige über das Label des referenzierten Knotens (inkl. Pseudonymisierung), Filter/Suche über den Zielknoten. Abgrenzung: Eine Referenz-Property ist ein gerichteter Verweis, **keine dritte Kante** — sie hat nie Ordnungs- oder Hierarchie-Wirkung und wird im BFS nicht traversiert. Braucht eine Relation mehr (mehr als drei Stellen, eigene Versionshistorie oder eigene Kanten an der Relation selbst), wird sie stattdessen als Zwischenknoten voll reifiziert (Eskalationspfad; Entscheid am Gate).

**FR-4.8 Konsistenz durch Konstruktion (implizierte Kanten).** Die Doppel-Reifizierung ist redundant — die Basis-Kante (`arbeitetBei`) ist aus der Referenz-Property ableitbar. Diese Redundanz wird nicht unabhängig gepflegt, sondern **deterministisch materialisiert**: Quellen (Crawler, Migrationsskript) schreiben nur den Primärfakt (die Kante mit der Referenz-Property); deklariert das Schema `implies`, erzeugt der Import die implizierte Kante automatisch mit **identischem Validity-Intervall** (idempotent — existiert sie schon, passiert nichts). Invariante, die der Import prüft (FR-6.8): Zu jeder zu T gültigen Kante mit Referenz-Property auf Ziel F existiert eine zu T gültige implizierte Kante desselben Quellknotens zu F; Widersprüche (unabhängig gelieferte, abweichende Stände) werden gemeldet, nicht still korrigiert. Die Umkehrung ist bewusst nicht gefordert — die Basis-Kante darf allein stehen (z. B. Firmenzugehörigkeit ohne bekannte Rolle).

---

## 5. Zeitmodell und Versionierung

**FR-5.1** Input sind **datierte Voll-Snapshots** (§3); das interne Modell sind **Validity-Intervalle**: Der Import (§6.3) difft jeden neuen Snapshot gegen den aktuellen Stand und schreibt Versionen fort.

**FR-5.2 Volle Versionierung von Knoten, Kanten und Properties.** Eine Version = ein **Record-Stand** mit Intervall `validFrom`/`validTo` (`null` = offen). Der Record-Stand umfasst `label` **und** `props` (beides ist versioniert); `id` und `type` sind dagegen **identitätsfest** — ein Typwechsel wäre eine neue Identität, kein Versionswechsel. Der Graph darf pro Identität mehrere Versionen mit disjunkten Intervallen enthalten: Knoten-Identität = `id`; Kanten-Identität = `type`+`source`+`target` **plus** die im Schema des Kantentyps deklarierten `identityProps` (E15) — typischerweise Referenz-Properties wie `kontext`, damit dieselbe Person dieselbe Rolle gleichzeitig bei zwei Firmen haben kann, ohne dass die Kanten zur selben Identität verschmelzen. Ändert sich irgendein Property-Wert (auch `label`), wird die offene Version geschlossen und eine neue eröffnet. Die vollständige Property-Historie (z. B. Pensum-Verlauf) ist damit aus der Versionsfolge rekonstruierbar; der Diff-Modus weist Änderungen auf **Property-Granularität** aus.

```json
{ "id": "p-1", "type": "Person", "label": "Anna Müller", "props": { "pensum": 80 }, "validFrom": "2025-08-28", "validTo": "2026-02-01" }
{ "id": "p-1", "type": "Person", "label": "Anna Müller", "props": { "pensum": 100 }, "validFrom": "2026-02-01", "validTo": null }
```

**FR-5.3** Zwei gleichwertige Zeitmodi der View: **`asOf`** (Stichtag-Slider; gerendert wird pro Identität die zu T gültige Version, `validFrom ≤ T < validTo`) und **`diff`** (T1→T2; Hervorhebung **neu** / **weggefallen** / **geändert**, letzteres mit Property-Diff im Tooltip).

**FR-5.4** Zeit ist orthogonal zu Mandanten: Profil = Tenant (eigener IndexedDB-Store), Snapshot = Zeit. Alle Zeitstände eines Mandanten liegen in dessen Store.

### 5.1 Signalisierung von Wegfall und Änderung (Lösungsvorschlag, entschieden umzusetzen)

Die ungelöste Frage «Wie signalisieren wir beim erneuten Crawl, dass ein Knoten, eine Kante oder ein Property nicht mehr vorhanden oder geändert ist?» wird über **Scope-deklarierte Vollstands-Semantik** gelöst — ohne explizite Löschmarker (Tombstones) im Datenformat.

Arbeitsteilung: Der **Crawler liefert immer einen Vollstand** seines Scopes und berechnet selbst kein Delta (er kennt den Stand des App-Stores nicht; ein Vollstand ist zudem idempotent und robust gegen Abbrüche). Der **Import macht daraus Create/Update/Delete**: Der erste Import ist die Basis, jeder weitere Snapshot wird gegen den aktuellen Store gedifft und schreibt die Versionen fort (FR-5.6). Der Store hält damit **einen** fortgeschriebenen, versionierten Graphen — nicht N unabhängige Stände; die Snapshot-Dateien unter `data/<tenant>/sources/` sind nur Rohdaten-Archiv und Provenienz.

**FR-5.5 Scope-Deklaration.** Jeder Snapshot deklariert in `meta.scope`, wofür er ein Vollstand ist: `{ "nodeTypes": […], "edgeTypes": […], "roots": […]?, "excluded": […]? }`. `roots` begrenzt optional auf Teilbäume (z. B. nur SEM-Subtree, nicht die ganze Bundesverwaltung); `excluded` listet Bereiche, die der Crawler nicht vollständig erfassen konnte.

**FR-5.5a Scope-Membership (formale Definition).** «War im Scope» bestimmt der Import ausschliesslich auf dem **Bestand vor dem Import**, nach diesen Regeln: (1) **Knoten:** Ohne `roots` ist ein Bestandsknoten im Scope, wenn sein Typ in `scope.nodeTypes` liegt; mit `roots` zusätzlich nur, wenn er von einem der `roots` über Bestandskanten der in `scope.edgeTypes` deklarierten Typen erreichbar ist — traversiert wird einheitlich **gegen die Kantenrichtung** (`target` → `source`), also von der Wurzel abwärts gemäss Richtungs-Konvention FR-7.2a. (2) **Kanten:** Eine Bestandskante ist im Scope, wenn ihr Typ in `scope.edgeTypes` liegt UND ihr `source`-Knoten im Node-Scope ist — der Kanten-Scope hängt am Quellknoten, nicht am Ziel; so schliesst ein Enrichment-Crawl (z. B. nur Trainings-Zuordnungen) verschwundene Kanten seiner erfassten Personen, ohne die Zielknoten anzutasten. (3) **`excluded`:** Knoten-IDs, die als ausgeschlossene Teilbaum-Wurzeln gelten — sie selbst und alles, was nur über sie erreichbar ist, fällt aus dem Scope. (4) **Referenzierte Bestandsknoten:** Snapshot-Kanten und Referenz-Properties dürfen auf Knoten ausserhalb des Scopes zeigen (FR-6.8 validiert gegen Snapshot ∪ Bestand); solche Ziele bleiben unberührt. Lösch-Kandidaten sind genau die Bestand-Identitäten, die nach (1)–(3) im Scope liegen und im Snapshot fehlen.

**FR-5.6 Diff-Regeln beim Import.** Pro Identität im Scope: (a) neu im Snapshot → neue Version mit `validFrom = datum(t)`; (b) **fehlt im Snapshot, war aber im Scope** → offene Version wird geschlossen (`validTo = datum(t)`) — das Fehlen im Vollstand IST das Signal, ein explizites Lösch-Flag braucht es nicht; (c) vorhanden, aber props abweichend (normalisierter Deep-Compare) → Version schliessen + neue eröffnen; ein in der neuen Version fehlendes Property gilt als entfernt (Teil des props-Stands). Identitäten **ausserhalb des Scopes bleiben unberührt** — über sie macht der Snapshot keine Aussage.

**FR-5.7 Schutz vor kaputten Crawls.** Der Crawler nimmt fehlgeschlagene Teilbereiche (Fetch-Fehler, Abbruch) in `meta.scope.excluded` auf oder exportiert gar nicht — Ausfälle dürfen nie als Löschungen fehlinterpretiert werden. Zusätzlich prüft der Import ein Plausibilitäts-Gate: Würden mehr als 20 % der Scope-Identitäten schliessen, verlangt der Import eine explizite Bestätigung (Dialog mit Zusammenfassung: n neu, n geschlossen, n geändert).

**FR-5.8 Sichtbarkeit.** Das Ergebnis wird dem Nutzer über den `diff`-Modus signalisiert (neu/weggefallen/geändert farblich, Property-Diff im Tooltip) und nach jedem Import als Toast-Zusammenfassung angezeigt.

---

## 6. Akquise und Import

### 6.1 Crawling (Browser, Claude-Chrome-Plugin)

Die Gewinnung ist bewusst **einstufig**: Jeder Provider-Crawler erzeugt **direkt** einen Snapshot im Zielformat (§3) — kein Roh-Zwischenformat, denn es gibt kein providerübergreifendes gemeinsames Rohformat; das gemeinsame Format ist die Zielstruktur. Crawler sind dabei **quellenspezifisch** (SBB ≠ SEM ≠ …) — generisch und geteilt sind nur die Registry, das Builder-Toolkit (stabile IDs, Dedup, Validierung, Snapshot-Hülle, IndexedDB-Konsolidierung) und das Regelwerk dieses Kapitels; der konkrete Quellenzugriff kann nicht generisch erledigt werden (FR-6.1c).

**FR-6.1 Zweiphasig mit Gate.** **Phase A (Analyse):** read-only Inventur über alle Folgeseiten in drei Dimensionen — (a) **Knoten-Arten** (Überschriften, Tabellen, Detailseiten-Entitäten), (b) **Verbindungs-Arten** (Linkarten, Spalten-Referenzen, Zuordnungen), (c) **Properties**: Feld-Inventar pro Knoten-Art mit Wertestatistik (Anteil numerisch, Eindeutigkeit pro Entität, Kardinalität und Teilungsgrad der Werte, Beispiele). Alles wird gegen die Registry abgeglichen; Report mit `known` (gemappt) und `untyped` (Kandidaten mit Beispielen und Häufigkeit); zusätzlich entsteht die provider-spezifische Harvest-Spezifikation (FR-6.1c) — dann **Stopp**. **Gate:** pro `untyped`-Eintrag entscheidet Mensch/LLM: bekanntem Typ zuordnen / neuen Typ in die Registry aufnehmen / als Property führen / ignorieren; für Property-Kandidaten liefert die Wertestatistik die Vorlage für die Reifizierungsentscheidung nach §4.3 (numerisch oder unique → `props`; kategorisch geteilt → Knoten + Kante). **Phase B (Voll-Crawl/Harvesting):** Ausführung der finalisierten Harvest-Spezifikation (FR-6.1c) — vollständige Extraktion ausschliesslich über die im Gate bestätigten Typen und Feld-Zuordnungen. Nichts bleibt still ungetypt; Unklares wird als `props.unclassified` markiert.

**FR-6.1a Registry-Bootstrap.** Es gibt keine separate Phase 0: Der Erstaufbau der Registry ist der Grenzfall von Phase A mit leerer Registry — dann ist jeder Kandidat `untyped`, und das Gate kuratiert daraus die initiale Registry (Commit an `schema/registry.json`). Liegt eine Registry vor, überprüft und ergänzt derselbe Lauf sie. Registry-Pflege folgt damit derselben Semantik wie die Daten: erster Stand = Basis, jeder weitere Lauf = Abgleich mit kontrollierter Fortschreibung — mit dem Unterschied, dass Registry-Änderungen immer durch das Gate (Mensch/LLM) und einen Commit gehen, nie automatisch.

**FR-6.1b Registry-Transport.** Der Crawl-Auftrag trägt eine Kopie des aktuellen Registry-Stands aus dem Repo in den Lauf; der Crawler kennt zu Laufbeginn also die Registry, aber bewusst **nicht** die Ergebnisse früherer Läufe (Vollstands-Semantik — das Diffen geschieht beim Import, FR-5.6). Der Snapshot vermerkt `meta.registryVersion` (Version oder Hash des verwendeten Registry-Stands); der Import warnt, wenn ein Snapshot gegen einen älteren Stand gecrawlt wurde als den im Tenant bekannten.

**FR-6.1c Harvest-Spezifikation pro Provider (zweites Phase-A-Ergebnis).** Phase A liefert neben dem Typen-Report ein zweites Teilresultat: die **Harvest-Spezifikation** des Providers. Sie umfasst den Quellenzugriff (API-Endpunkte bzw. DOM-Selektoren, Navigation/Paginierung, Herkunft der stabilen IDs), das Mapping Quellfeld → Registry-Typ/Kante/Property und die Crawl-Strategie (Traversal-Reihenfolge, Batching, Scope). Form nach Automatisierungs-Priorität «Skript vor LLM»: bevorzugt ein direkt **ausführbares Harvest-Skript**; wo das Skript erst noch erzeugt werden muss, ein **präziser Prompt**, aus dem es generiert wird. Nach dem Gate wird die Spezifikation mit den bestätigten Typisierungen finalisiert — **Phase B ist die Ausführung genau dieser Spezifikation**, keine erneute Interpretation der Quelle. Harvest-Spezifikationen und -Skripte werden pro Provider im Repo versioniert (`data/crawling/<provider>/`), damit jeder Re-Crawl reproduzierbar ist und Phase A bei unveränderter Quelle übersprungen werden kann.

**FR-6.2 Identität.** Stabile IDs vom Quell-PK: In strukturierten Quellen ist jede Entität verlinkt, die ID steckt im Link-Ziel/der URL (sonst E-Mail oder Quell-OE-ID); Beziehungen referenzieren das verlinkte Ziel, nie den Anzeigenamen. Fehlt jede stabile Kennung: `slug(label)` mit `props.idSource='name'`.

**FR-6.3 Konsolidierung.** Der Crawl konsolidiert über alle Seiten hinweg in IndexedDB auf der Quell-Origin (Store `nodes` mit keyPath `id`, Store `edges` mit keyPath `key` = `type|source|target`, erweitert um die Werte deklarierter `identityProps`, E15): upsert-basiert, dedupliziert, resume-fähig, Re-Run derselben Seite idempotent. Auch Basisquellen (Personen-OE-Graph mit Hierarchie) werden in denselben Store gemerged.

**FR-6.3a Ein Lauf = ein Snapshot; der Crawl-Store ist lauf-lokal.** Der IndexedDB-Store auf der Quell-Origin ist Akkumulator **eines einzelnen Crawl-Laufs**, kein Cache über Läufe hinweg. Er führt einen Lauf-Marker (Snapshot-Stempel, Startzeit, `registryVersion`). Ein unterbrochener Lauf wird am Marker erkannt und **fortgesetzt** (resume); ein **neuer** Lauf startet zwingend mit leerem Store — liegen unexportierte Daten eines früheren Laufs vor, fragt der Crawler explizit: fortsetzen oder verwerfen, niemals mischen (sonst würden zwischenzeitlich an der Quelle verschwundene Entitäten als vorhanden exportiert und die Vollstands-Semantik aus §5.1 verletzt). Nach bestätigtem Export wird der Store geleert; ab dann sind Quell-IndexedDB und Repository deckungsgleich — Snapshot-Dateien und Registry im Repo sind die einzige persistente Wahrheit zwischen Läufen.

**FR-6.4 Verhalten.** Nur lesen (keine Klicks auf Aktionen, keine Formulare); bevorzugt interne JSON-APIs (Network-Tab) vor DOM-Scraping; Folge-Seiten gechunkt (Batches ~5, randomisierte Pausen, Backoff bei 429/5xx); Labels normalisieren (De-Gendering nur für Anzeige-Labels, nie für API-Namen; Whitespace kollabieren).

**FR-6.5 Export.** Am Schluss ein einziger Blob-Download `crawl-<quelle>-<YYYYMMDD-HHMM>.json` mit `meta` (inkl. **`scope`**, §5.1), `schema` (verwendete Teilmenge) und den konsolidierten `nodes`/`edges`. Store erst nach bestätigtem Export leeren. Snapshots liegen historisiert unter `data/<tenant>/sources/`.

### 6.2 Scope-Ermittlung im Crawler

**FR-6.6** Der Crawler kennt seinen Auftrag und deklariert den Scope selbst: die im Gate bestätigten Typen als `nodeTypes`/`edgeTypes`, die Start-Wurzel(n) als `roots`, gescheiterte Teilbäume als `excluded` (§5.7). Ein Enrichment-Crawl (z. B. nur Trainings-Seiten) deklariert nur seine Typen und löscht damit nichts ausserhalb.

### 6.3 Import in die App

**FR-6.7 Eingang.** Snapshots gelangen per Drag&Drop (bestehende Dropzone) oder Dateidialog in die App; Erkennung inhaltsbasiert (`meta.snapshot` + `schema` + `nodes`/`edges`).

**FR-6.8 Validierung.** Vor dem Diff: Schema ist Teilmenge der im Tenant bekannten Registry; Kanten-Endpunkte existieren (im Snapshot oder im Bestand) und respektieren `from`/`to`; Knoten-Referenz-Properties (FR-4.7) zeigen auf existierende Knoten des deklarierten Typs; implizierte Kanten werden materialisiert und die Konsistenz-Invariante geprüft (FR-4.8); IDs eindeutig; Zyklen-Warnung pro definierter View: Bilden deren `hierarchyEdges` im neuen Bestand Zyklen, wird mit Details gewarnt (kein stiller Drop; die BFS bleibt robust, FR-7.2).

**FR-6.9 Fortschreibung.** Diff nach FR-5.6 gegen den Tenant-Store, Versionsfortschreibung, Plausibilitäts-Gate (FR-5.7), Toast-Zusammenfassung (FR-5.8). Eine Snapshots-Registry im Tenant-Store verzeichnet importierte Snapshot-Stempel; ein bereits importierter Snapshot wird erkannt und ist ein No-op (**Idempotenz**). Snapshots müssen chronologisch importiert werden; ein älterer Stempel als der jüngste importierte wird mit Hinweis abgewiesen.

---

## 7. Views und Projektionen

Eine View projiziert aus dem Gesamtgraphen einen darstellbaren, geordneten Teilgraphen. Views sind in `env.json` vordefiniert und maschinenprüfbar definiert in [`schema/view.schema.json`](schema/view.schema.json). **Hierarchie ist ausschliesslich ein View-Konzept (E18)**: Der Graph selbst ist nur gerichtet; erst `hierarchyEdges` einer View machen bestimmte Kantentypen zum Baum. Fehlt `VIEWS`, gibt es folglich keine Hierarchie — die App stellt dann **alle Knoten** dar (alle Typen, keine Ordnung, alle Order 0, reines Force-Layout) und weist auf die fehlende View-Konfiguration hin; die ausgelieferte Start-View (FR-7.4) ist dagegen explizit definiert.

Beispiel (illustrativ, mit den Beispiel-Typen aus §4.1 — E14):

```json
"VIEWS": {
  "Personenhierarchie": {
    "roots": ["__auto__"],
    "edgeTypes": ["berichtetAn", "mitgliedIn", "unterstellt", "hatRolle"],
    "hierarchyEdges": ["berichtetAn", "mitgliedIn", "unterstellt"],
    "visibleNodeTypes": ["Person", "OE"],
    "render": { "OE": "cluster", "Rolle": "ring", "Team": "ring", "Training": "ring", "Projekt": "ring" },
    "depth": 3
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

**FR-7.1 View-Felder.** `roots` (Wurzel-IDs; `"__auto__"` = Knoten ohne eingehende Kante eines `hierarchyEdges`-Typs dieser View), `edgeTypes` (traversierte/gezeigte Kantentypen), `hierarchyEdges` (Pflichtfeld; Teilmenge der `edgeTypes`, die den Baum aufspannt — die **einzige** Quelle der Hierarchie, E18), `visibleNodeTypes` (gilt nur für **eigenständig gerenderte** Knoten, Modi `node`/`cluster`; `ring`-Zieltypen erscheinen unabhängig davon über ihre Kante, FR-7.3; `"*"` = alle erreichbaren), `render` (pro Typ, §7.3), `depth` (optionaler Start-Tiefenwert), `time` (optional `asOf`/`diff`, §5), `filters` (optionale deklarative Einschränkungen, FR-7.8).

**FR-7.2 Ordnung.** Order 0 = `roots`; BFS ausschliesslich entlang der `hierarchyEdges`, abwärts gemäss FR-7.2a; `order(n)` = kürzeste Distanz zur nächsten Wurzel. Mehrfach-Eltern: **eine** Knoteninstanz (Identität, Suche, Pseudonymisierung und Diff hängen an stabilen IDs), flachste Hierarchie-Kante bestimmt die Ordnung, **alle** Eltern-Kanten werden als vollwertige Verbinder gezeichnet — die gerichteten Filter erzeugen möglichst baumnahe Subgraphen, die sichtbare Mehrfach-Kante ist die legitime Ausnahme. Zyklen: Über die `hierarchyEdges` einer View sollen laut Datenvertrag keine auftreten (der Import warnt, FR-6.8); die BFS nimmt die flachste Distanz und ignoriert Rück-Kanten. Nicht über `hierarchyEdges` Erreichbares erscheint nur als Quer-Link-Ziel. Übrige `edgeTypes` sind Quer-Verbindungen ohne Ordnungseffekt.

**FR-7.2a Kantenrichtung (normative Konvention, E17).** Kanten zeigen **vom Untergeordneten zum Übergeordneten** (`source` = Kind/Mitglied/Beteiligte:r, `target` = Eltern/Container/Bezugsobjekt) — die Kantennamen lesen sich als Satz («A berichtetAn B» = B ist Vorgesetzte:r). Diese Konvention gilt für **alle** Kantentypen; sie ist es, die es jeder View erlaubt, einen beliebigen Kantentyp als `hierarchyEdges` zu designieren: Der Baum-Abstieg von den `roots` (Ordnung FR-7.2, Scope-Traversal FR-5.5a) traversiert dann einheitlich **gegen** die Kantenrichtung (`target` → `source`). Für die Beispiel-Typen (E14) und das Legacy-Mapping gilt:

| Kantentyp (Beispiel) | `source` (Rolle) | `target` (Rolle) | BFS-abwärts | Legacy-Mapping (FR-10.3) |
|---|---|---|---|---|
| `berichtetAn` | Mitarbeiter:in (untergeordnet) | Vorgesetzte:r | `target` → `source` | Legacy Person→Person ist **Manager→Mitarbeiter** → wird beim Migrieren **umgedreht** |
| `mitgliedIn` | Person (Mitglied) | OE (Container) | `target` → `source` | Legacy Person→OE zeigt bereits Person→OE → **unverändert** |
| `unterstellt` | Unter-OE | Ober-OE | `target` → `source` | Legacy OE→OE ist **Parent→Child** → wird beim Migrieren **umgedreht** |

**FR-7.3 Render-Modi pro Typ und View.** `node` = eigenständiger Graph-Knoten mit Kanten; `cluster` = konvexe Hülle um die verbundenen Knoten (heutige OE-Darstellung, jetzt generischer Render-Modus); `hidden` = ausgeblendet, aber für Filter/Suche verfügbar. **`ring` (formal):** Der `ring`-gerenderte **Zielknoten** einer Kante erscheint als Ring/Badge am **`source`-Knoten** dieser Kante (heutige Attribut-Darstellung); er ist kein eigenständiges Layout-Element und zählt nicht zu `visibleNodeTypes`, ist aber voll such-, filter- und legendenfähig — seine Sichtbarkeit steuert die Ring-Legende (FR-8.2), sein Farb-Hue der Typname (FR-4.2a). Default für erreichte, nicht deklarierte Typen ist `node`.

**FR-7.4 Start-View.** Die erste definierte View bildet die heutige aktive Darstellung 1:1 ab: Ihre `hierarchyEdges` zählen explizit die Kantentypen auf, die den heutigen Org-Baum bilden (aus der Migration: die drei Legacy-Beziehungsarten). Die konkreten Namen («Personenhierarchie», `berichtetAn`, …) sind Illustration (E14).

**FR-7.5 View-Wechsel.** Footer-Switcher analog zum bestehenden Profil-Switcher; View-Wechsel setzt Laufzeit-Übersteuerungen (FR-7.6/7.7) zurück.

**FR-7.6 Laufzeit-roots.** Die bestehende Such-Combo bleibt: Auswahl ersetzt die View-`roots` (`setSingleRoot`), Shift-Klick/Shift-Enter fügt den Treffer als weiteren Root hinzu (`addRoot`, max. 5). Die Suche läuft über alle `visibleNodeTypes` der aktiven View mit deren `identifiers`-Capability. Die View-Definition bleibt unverändert (temporäre Übersteuerung).

**FR-7.7 Laufzeit-Tiefe.** Der View-`depth` ist der Startwert; der bestehende Toolbar-Regler (0–6) übersteuert zur Laufzeit.

**FR-7.8 View-Filter (Properties und Referenz-Properties).** Eine View kann den projizierten Teilgraphen deklarativ einschränken, z. B. `"filters": { "nodes": [ { "type": "Person", "prop": "pensum", "op": "gte", "value": 80 } ], "edges": [ { "type": "hatRolle", "prop": "kontext", "op": "refEq", "value": "firma-akros" } ] }` (illustrativ, E14). Operatoren v1: `eq`, `neq`, `in`, `exists`, `gte`, `lte` für Skalare; `refEq`/`refIn` für Knoten-Referenz-Properties (Vergleich über die Ziel-**ID**; die UI zeigt und wählt über das aufgelöste Label). Node-Filter entfernen den Knoten samt seiner Kanten aus der Projektion, Edge-Filter nur die Kante. Filter wirken nach der Traversal-Projektion (roots/Tiefe/Typen/Zeitschnitt) und vor dem Layout.

---

## 8. Funktionale Anforderungen an die App

**FR-8.1 Rendering-Pipeline.** Nie der ganze Graph: View-Projektion (roots + Tiefe + Typen + Zeitschnitt) → Teilgraph → Layout → Render. Force-Layout läuft nur auf dem projizierten Teilgraphen (SEM: 53k Knoten / 114k Kanten im Bestand sind unkritisch, solange die Projektion begrenzt).

**FR-8.2 Legenden, typgetrieben.** Die heutigen drei Legenden verallgemeinern sich: (a) Cluster-Legende = Baum aller `cluster`-gerenderten Knoten der View (heutige OE-Legende) inkl. Filterfeld, Toggle-All, Auge, Kontextmenü; (b) Ring-Legende = Gruppen der `ring`-gerenderten Typen mit Trefferzahlen und Farbchips (heutige Attribut-Legende) inkl. Fokus-Trichter; (c) Ausgeblendet-Legende unverändert. Legend-Row-Factories werden wiederverwendet.

**FR-8.3 Filter.** Blatt-Filter (heute «Management») über `leafProp`-Capability typunabhängig; Sichtbarkeits-Toggles pro Knotentyp (verallgemeinert den OE-Sichtbarkeits-Toggle); Ring-Fokus-Pruning (heute Attribut-Fokus) läuft über die View-Kanten statt über hardcodierte Aufwärtskanten.

**FR-8.4 Suche.** Wort-Präfix-Matching und Dropdown unverändert; Suchraum = sichtbare Knotentypen der View, Felder aus `identifiers`.

**FR-8.5 Pseudonymisierung.** Pro Knotentyp über die `pseudonymize`-Capability (Pool, optional level-abhängig); Passwortschutz beim Deaktivieren bleibt (`TOOLBAR_PSEUDO_PASSWORD`).

**FR-8.6 Zeit-UI.** Neuer Zeit-Slider (asOf) und Diff-Auswahl (T1/T2) in der Toolbar oder im Footer, nur aktiv, wenn der Tenant mehr als einen Snapshot-Stand enthält.

**FR-8.7 Kontextmenü.** Rechtsklick auf Knoten: Ausblenden (Subtree über Hierarchie-Kanten der View), Als Root definieren / entfernen — typunabhängig. Das Attribut-Editier-Submenü entfällt (Datenpflege geschieht an der Quelle bzw. im Crawl, nicht im Viewer).

**FR-8.8 Export.** SVG/PNG-Export-Dialog unverändert.

**FR-8.9 Persistenz.** IndexedDB-Profilarchitektur (ein Object-Store pro Tenant, `__meta__`-Store) unverändert; pro Tenant zusätzlich: Graph (Versionen), Snapshots-Registry, env/Views, Pseudo-Daten.

**FR-8.10 Konfiguration.** `env.json` bleibt der Konfigurationsträger: `VIEWS` (neu), bestehende `TOOLBAR_*`- und `LEGEND_*`-Schlüssel behalten ihre Funktion (Blatt-Filter-Default, Richtung, Tiefe, Labels, Zoom, Pseudo, Debug, Simulation, Collapse-Zustände, Hidden-Roots, Start-IDs). `ATTRIBUTE_TYPES`, `DATA_ATTRIBUTES_URL` und `DATA_ATTRIBUTES_DIR` entfallen (Legacy, §10); `DATA_URL` zeigt auf einen Graph-Snapshot.

---

## 9. Übernahme aus der bestehenden App

Grundsatz (E12): Alle passenden UI-Elemente, Algorithmen und Eigenschaften werden übernommen. Drei Kategorien:

### 9.1 Unverändert übernommen (bereits generisch)

| Baustein | Ort heute |
|----------|-----------|
| Build-System (Single-File aus 20 Sections, `stripModuleSyntax`) | `build.js`, `index.template.html` |
| Icon-Registry (SVG, dependency-frei) | `02-icons.js` |
| Storage-/Profilschicht (IndexedDB-Tenants, Datei-Klassifikation, Persistenz-Request) | `04-storage.js` |
| ZIP-Reader (`DecompressionStream`) | `05-dropzone.js` |
| Dropzone/Overlay + globales Drag&Drop | `05-dropzone.js` |
| Export-Dialog (SVG/PNG, Presets, Canvas) | `03-export-dialog.js` |
| Adjazenzliste `buildAdjacency`, BFS-Levels `getNodesLevels` | `11`/`13` |
| Wort-Präfix-Matching `matchesWordPrefixes` | `10-combo.js` |
| Levenshtein/Fuzzy-Kern | `15-ui-apply-search.js` |
| Farb-Geometrie: `hashCode`, `quantizedHueFromCategory`, `colorForCategoryAttribute`, `colorToTransparent` | `08-color-geometry.js` |
| Level-animierte Graph-Transition | `14-render.js` |
| Toast, Statuszeile, Footer-Stats, Profil-Switcher, Reset | `01`/`08`/`18`/`20` |
| CSS-Custom-Properties als Simulations-/Geometrie-Parameter | `styles.css` + `cssNumber` |

### 9.2 Übernommen mit Generalisierung (Algorithmus bleibt, Typbezug wird deklarativ)

| Baustein | Heute hardcoded | Neu |
|----------|-----------------|-----|
| **Radiales Initial-Layout + BFS-Expansion** (`initializeRadialLayout`, `radialLayoutExpansion`, Hüllen-Platzierung sekundärer Roots) | nur Personen-Knoten, Parent-Map aus Person-Person-Links | **Algorithmus identisch**; arbeitet auf den `node`-gerenderten Knoten des projizierten Teilgraphen, Parent-Map aus `hierarchyEdges` |
| **Force-Simulation** (D3-Forces, Parameter aus CSS-Vars, Kollisionsradius inkl. Ringe) | Kanten-/Cluster-Logik Person/OE | **Kräfte und Parameter identisch**; Ringe = `ring`-gerenderte Nachbarn, Cluster = `cluster`-gerenderte Knoten |
| **Hierarchie-Layout** (`computeHierarchyLevels`, forceX/forceY-Gruppierung) | Manager→Mitarbeiter-Kanten, OE-Cluster-Zentren | Levels über `hierarchyEdges` der View; Gruppierung um Zentren der `cluster`-Knoten |
| BFS-Subgraph `computeSubgraph` (Tiefe, Richtung up/down/both) | typgesteuerte Kantenfilter (Person→Org-Unterdrückung etc.) | Traversal über `edgeTypes`/`hierarchyEdges` der View; Richtungs-Semantik aus Kantenrichtung statt Typpaaren |
| Cluster-Hüllen (`refreshClusters`, `computeClusterPolygon`, Punkt-in-Polygon) | OE-Hierarchie fix | Render-Modus `cluster` für beliebige Typen; Hüllen-Hierarchie über die Kanten zwischen Cluster-Knoten |
| Blatt-Filter («Management») | `isBasis` an Personen | `leafProp`-Capability (FR-8.3) |
| Subtree-Ausblenden (`collectReportSubtree`) | nur Person→Person | Hierarchie-Kanten der View |
| Ring-Fokus (`recomputeAttributeFocusHidden`) | Aufwärtskanten fix | View-Kanten (FR-8.3) |
| Pseudonymisierung (`getPseudoName`/`getPseudoOrgLabel`) | Person/OE-Verzweigung | `pseudonymize`-Capability (FR-8.5) |
| Fuzzy-Suche (Domäne) | `raw.persons`, id/email/label | `identifiers`-Capability über sichtbare Typen |
| Farbstrategien (`getNodeFillByLevel`, `colorForOrg`, Kategorie-Hue) | Personen bzw. OEs bzw. Attribut-Kategorien fix | Strategie folgt dem Render-Modus der View: `node` → byLevel, `cluster` → hash, `ring` → categoryHue (FR-4.2a) |
| Legenden (OE-/Attribut-/Hidden) | Begriffe und Datenpfade fix | typgetrieben nach Render-Modus (FR-8.2) |
| Tooltips (Emojis, «OEs», «Attribute») | fix | Typnamen aus der Registry (FR-4.2a) |
| Knoten-Kontextmenü | Personen-spezifisch | typunabhängig (FR-8.7) |
| Toolbar-Toggles (Tiefe, Richtung, Hierarchie, Labels, Fit, Simulation, Pseudo, Debug) | Verhalten generisch, Defaults env | unverändert, plus Zeit-UI (FR-8.6) |

### 9.3 Entfällt in der App (wandert ins Einmal-Migrationsskript, §10)

| Baustein | Grund |
|----------|-------|
| Attribut-TSV-Upload, `parseAttributeList`, Kategorie-Speichern/TSV-Export, File-Handles | Legacy-Attribut-Pfad; Attribute sind künftig Knoten/props im Snapshot |
| Fuzzy-Match-Dialog (`17-fuzzy-dialog.js`) + `KEY_ATTR_MATCHES`-Persistenz | Identifier-Zuordnung geschieht einmalig in der Migration (CLI-Report + Mapping-Datei) |
| Attribut-Editier-Submenü im Kontextmenü | Datenpflege an der Quelle, nicht im Viewer |
| `looksLikeData`-Erkennung des Alt-Formats, `processData` (persons/orgs/links) | App versteht nur noch Snapshots (§3) |
| `ATTRIBUTE_TYPES`, `DATA_ATTRIBUTES_URL`, `DATA_ATTRIBUTES_DIR` in env.json | Mapping-Konfiguration lebt im Migrationsskript |

---

## 10. Einmalmigration Alt → Neu

**FR-10.1** Die Migration des alten Datenmodells ist **kein Bestandteil der App**, sondern ein separates, einmalig ausgeführtes Node-Skript `scripts/migrate-legacy.mjs`. Da die App nie distribuiert wurde, gibt es keine fremden Bestände — eine Einmalmigration der eigenen Datensätze (HRM, SBB-GD, SEM v1, Beispieldaten) genügt.

**FR-10.2 Input/Output.** Input: `data.json` (persons/orgs/links nach [DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md)), Attribut-TSVs, optional `pseudo.data.json`; Mapping-Konfiguration (das bisherige `ATTRIBUTE_TYPES`-Schema: `property` / `node` / `contextRole` pro Kategorie) liegt als Konfigblock im Skript bzw. daneben. Output: ein Snapshot (§3) pro Mandant, `meta.snapshot` aus dem Datum des Quellstands, `meta.scope` = alle migrierten Typen.

**FR-10.3 Abbildung.** `persons[]` → `type:"Person"` (`email`/`isBasis` → `props`); `orgs[]` → `type:"OE"`; Links P→P/P→OE/OE→OE → `berichtetAn`/`mitgliedIn`/`unterstellt`, wobei die Richtungen gemäss FR-7.2a **normalisiert** werden: Legacy Person→Person (Manager→Mitarbeiter) und Legacy OE→OE (Parent→Child) werden umgedreht, Legacy Person→OE bleibt; Attribut-Kategorien nach Mapping-Konfiguration (Heuristik als Default: numerisch oder unique pro Person → `props`; kategorisch/geteilt → Knoten + Kante; Kontext+Rolle → doppelt reifiziert nach FR-4.6). Die Ziel-Typnamen richten sich nach dem beim Migrationslauf gültigen Registry-Stand; die Nennungen hier sind Illustration (E14).

**FR-10.4 Identifier-Zuordnung.** Die bisher interaktive Fuzzy-Zuordnung (Attribut-Identifier → Person über ID/E-Mail/Name, Levenshtein ≤ 0.3) läuft im Skript: eindeutige Treffer automatisch, mehrdeutige und Nicht-Treffer als Report (`unmatched.csv` + Vorschlagsliste); ein manuell gepflegtes Mapping-File wird beim Re-Run berücksichtigt. Das Skript ist **idempotent** — gleicher Input + gleiches Mapping ⇒ identischer Output.

**FR-10.5 Verifikation.** Nach der Migration muss die Start-View «Personenhierarchie» mit den migrierten Daten dieselben Knoten- und Kantenzahlen liefern wie die alte App mit den Quelldaten (Brutto-Zahlen im Migrationsreport ausweisen).

---

## 11. Nicht-funktionale Anforderungen

| # | Anforderung |
|---|-------------|
| NFR-1 | Single-File-Auslieferung (`index.html`), offline via `file://`, keine Laufzeit-Dependencies ausser dem eingebetteten D3. |
| NFR-2 | Skalierung: Bestand bis mindestens **75k Knoten / 200k Kanten inkl. Versionsrecords** in IndexedDB (Referenzbestand: 62k Knoten / 114k Kanten an Identitäten); Projektion und Rendering bleiben flüssig, weil nie der Gesamtgraph gerendert wird (FR-8.1). Das Wachstum der Versionsrecords über viele Snapshots wird bewusst **ohne Vorab-Massnahmen** beobachtet (Entscheid 2026-07); Grenzwerte werden erst bei realem Bedarf nachgezogen. |
| NFR-3 | Import des SEM-Referenzbestands (62k Knoten / 114k Kanten) dauert unter 30 s auf der Entwickler-Maschine, erzeugt keinen einzelnen Main-Thread-Block über 200 ms und zeigt innert 500 ms nach Import-Start eine Fortschrittsanzeige (Batch-Verarbeitung wie bei der heutigen Fuzzy-Suche). |
| NFR-4 | Idempotenz: Re-Import desselben Snapshots, Re-Run des Crawls auf derselben Seite und Re-Run des Migrationsskripts sind No-ops bzw. deterministisch. |
| NFR-5 | Typ-Agnostik ist prüfbar: kein kanonischer Typname als String-Literal im Engine-Code (Lint-Regel/Testsuche), ausgenommen Registry, Test-Fixtures und Migrationsskript. |
| NFR-6 | Pseudonymisierung wirkt überall, wo Labels erscheinen (Graph, Legenden, Tooltips, Suche, Export). |

---

## 12. Ausbaustufen (v2+)

- Speichern eigener Views (aktuelle Projektion als benannte View im Tenant-Store, erscheint im Footer-Switcher).
- Kleines GQL/openCypher-Subset für Ad-hoc-Abfragen (ISO/IEC 39075:2024) — nur falls deklarative Views nicht mehr reichen.
- Property-Verlaufs-Ansicht pro Knoten (Timeline aus der Versionsfolge).
- Persistente Laufzeit-Übersteuerungen (roots/Tiefe pro Profil merken).

---

## 13. Akzeptanzkriterien

1. **Zahlenmässige Äquivalenz (hart, automatisiert):** Die Start-View rendert den migrierten SEM-Referenzbestand mit exakt denselben Brutto-Zahlen wie die heutige App in der Referenz `PRD-Reference-Screenshot.png` (v1.27.14; geladen 62 144 Knoten / 113 874 Kanten / 9 045 OEs; Wurzel «Vincenzo Mascioli», Tiefe 3: **487 sichtbare Knoten, 793 sichtbare Kanten**, 69/69 Ring-Gruppen, 7/2778 ausgeblendet). Geprüft per Playwright: Elementzählung pro SVG-Ebene (Knoten, Kanten, Cluster-Hüllen, Ringe) und Legenden-Einträge — exakter Match.
2. **Visuelle Äquivalenz (dokumentierte Sichtprüfung):** Playwright-Screenshot derselben Szene (gleicher Datenstand, gleiche Wurzel/Tiefe/Richtung, Viewport wie Referenz) wird neben `PRD-Reference-Screenshot.png` abgelegt und verglichen; da das Force-Layout nicht deterministisch ist, gilt Kriterium 1 als harte Prüfung, der Screenshot-Vergleich dokumentiert Layout-Charakter, Farben, Ringe, Legenden und Footer.
3. Ein AdminDir-Crawl (Phase A → Gate → Phase B) liefert einen validen Snapshot mit `meta.scope`, der ohne Handarbeit importierbar ist.
4. Zwei Snapshots desselben Scopes mit einer entfernten Identität, einer geänderten skalaren Property und einem neuen Knoten ergeben nach Import: geschlossene Version, zwei Versionen mit Property-Diff, neue Identität — und der `diff`-Modus zeigt alle drei Fälle an.
5. Ein Snapshot mit engem Scope (einzelner Knoten- und Kantentyp) lässt den restlichen Bestand unangetastet.
6. Ein Re-Import desselben Snapshots ändert nichts (Toast: «bereits importiert»).
7. Ein neuer Knotentyp, nur in Registry und View deklariert, erscheint mit Farbe, Legende, Suche und Rendering ohne jede Codeänderung.
8. Such-Combo mit Shift-Add, Tiefen-/Richtungs-Toggles, Blatt-Filter, Pseudonymisierung, SVG/PNG-Export und Profil-Switcher funktionieren wie heute.
9. NFR-5-Prüfung (kein Typname im Engine-Code) besteht.
10. Die NFR-3-Grenzwerte (Importdauer < 30 s, kein Main-Thread-Block > 200 ms, Fortschritt < 500 ms) werden mit dem SEM-Referenzbestand eingehalten und gemessen protokolliert.
11. **Schema-Validierung:** Registry, jeder erzeugte Snapshot (Crawl und Migration) und die `VIEWS`-Konfiguration validieren gegen ihre JSON Schemas (`registry.schema.json`, `snapshot.schema.json`, `view.schema.json`).
12. **Kantenrichtungs-Migrationstest:** Ein Legacy-Bestand mit Manager→Mitarbeiter- und Parent→Child-Links ergibt nach der Migration ausschliesslich Hierarchie-Kanten vom Untergeordneten zum Übergeordneten (FR-7.2a), und die BFS-Ordnung der Start-View reproduziert den heutigen Baum.
13. **Scope-Löschtest mit Root-Begrenzung:** Ein Snapshot mit `scope.roots` auf einen Teilbaum schliesst verschwundene Identitäten nur innerhalb dieses Teilbaums (FR-5.5a); identisch fehlende Identitäten ausserhalb bleiben offen.

---

## 14. Offene Punkte

1. Zeit-UI-Detail: Platzierung und Form von asOf-Slider und Diff-Auswahl (Toolbar vs. Footer), Verhalten bei nur einem Snapshot-Stand.
2. Pseudonym-Pools für neue Knotentypen (Rolle, Projekt, Firma, …): eigene Pools oder generischer Fallback (`<Typ> N`)?
3. Speicher-Layout der Versionen in IndexedDB (ein Record pro Version vs. Versions-Array pro Identität) — Implementierungsentscheid, im PRD bewusst offen.

Gelöst seit der ersten Fassung: Das Registry-Format ist nicht mehr offen — es ist als JSON Schema in `schema/registry.schema.json` definiert (FR-4.1).
