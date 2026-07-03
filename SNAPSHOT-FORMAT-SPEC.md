# SNAPSHOT-FORMAT-SPEC — OrgGraph 2.0 Snapshot-Format

Kompakte Referenz für das wiederverwendbare Snapshot-Format von OrgGraph 2.0. Normativ sind [PRD.md §3](PRD.md) und [`schema/snapshot.schema.json`](schema/snapshot.schema.json) (Rangfolge: PRD §1.6); dieses Dokument ist die Kurzfassung für Crawler-Autoren und Tooling. Das Alt-Format (persons/orgs/links + Attribut-TSV) ist in [DATA-FORMAT-SPEC.md](DATA-FORMAT-SPEC.md) dokumentiert und nur noch Input des Einmal-Migrationsskripts.

## Grundprinzipien

- Ein Snapshot ist ein **datierter Vollstand** eines deklarierten Scopes — nie ein Delta. Das Diffen (Create/Update/Delete, Versionierung) macht ausschliesslich der Import in der App (PRD §5.1).
- Snapshots sind **roh und unversioniert** (PRD E20): keine `validFrom`/`validTo` — Validity-Intervalle sind interne Store-Darstellung.
- Kanten zeigen **vom Untergeordneten zum Übergeordneten** (PRD E17/FR-7.2a): «A berichtetAn B» heisst B ist Vorgesetzte:r; der Baum-Abstieg traversiert gegen die Kantenrichtung.
- IDs sind **stabil** und **global eindeutig interpretierbar** (PRD E66/FR-3.5): global eindeutige natürliche Kennung (E-Mail, vollständige URL-ID — der gewollte Multi-Source-Join-Schlüssel) oder source-namespaced; rohe quell-lokale Schlüssel (nackte PKs) sind unzulässig. Notfalls namespaced Fallback `<source>:<Typ>:<slug(label)>` mit `props.idSource='name'` — nie nackter `slug(label)` (PRD E41). Stabile IDs sind Voraussetzung für Diff und Versionierung.
- Alle verwendeten Typen müssen in der kuratierten Registry (`schema/registry.json`) existieren; das eingebettete `schema` ist deren Teilmenge (PRD FR-3.4).

## Struktur

```json
{
  "meta": {
    "source": "admindir",
    "sourceUrl": "https://admindir.example",
    "crawledAt": "2026-06-18T15:00:00Z",
    "snapshot": "20260618-1500",
    "registryVersion": "2026-06-01.3",
    "scope": {
      "nodeTypes": ["Person", "OE"],
      "edgeTypes": ["berichtetAn", "mitgliedIn", "unterstellt"],
      "roots": ["oe-sem"],
      "edgeSources": ["p-1", "oe-sem"],
      "excluded": []
    }
  },
  "schema": {
    "nodeTypes": { "Person": { "labelProp": "label" }, "OE": {} },
    "edgeTypes": {
      "berichtetAn": { "from": "Person", "to": "Person" },
      "mitgliedIn": { "from": "Person", "to": "OE" },
      "unterstellt": { "from": "OE", "to": "OE" }
    }
  },
  "nodes": [
    { "id": "p-1", "type": "Person", "label": "Anna Müller", "props": { "email": "anna@example.ch" } }
  ],
  "edges": [
    { "type": "mitgliedIn", "source": "p-1", "target": "oe-sem", "props": {} }
  ]
}
```

## Feld-Referenz

- **`meta`** (alle fünf Felder Pflicht): `source` (kanonischer Quellen-Identifier `^[a-z][a-z0-9-]*$`, identisch mit dem Harvest-Spec-`provider`; Quell-URL separat in `sourceUrl` — PRD E62), `crawledAt` (RFC3339 mit Offset/`Z`), `snapshot` (Stempel `YYYYMMDD-HHMM` in **UTC**, entspricht der UTC-Minute von `crawledAt` — PRD E50; harte chronologische Import-Ordnung gilt nur für **root-freie Vollstände** pro (Quelle, Scope-Fingerprint) — rooted/Enrichment-Snapshots importieren auch out-of-order und werden pro besuchtem `edgeSources`-Knoten über Instant-Monotonie geordnet, PRD FR-6.9/E65), `registryVersion` (Registry-Stand des Laufs, PRD FR-6.1b), `scope` (wofür dieser Snapshot ein Vollstand ist, PRD FR-5.5).
- **`meta.scope`**: `nodeTypes`/`edgeTypes` (Pflicht; erfasste Typen), optional `roots` (Teilbaum-Begrenzung), `excluded` (ausgeschlossene Teilbaum-Wurzeln, z. B. gescheiterte Fetches — Ausfälle dürfen nie als Löschungen fehlinterpretiert werden, PRD FR-5.7) `edgeSources` (besuchte Quellknoten-IDs: Vollstand für deren ausgehende Kanten der deklarierten `edgeTypes`, keine Knoten-Closure — PRD E30/E59), `edgeTargets` (vollständig beobachtete Ziel-Container: Gegenbeweis für Move-out-Schliessungen; fehlt es, keine Move-out-Closure — PRD FR-5.5a) `traversalEdgeTypes` (Kantentypen nur für die `roots`-Grenzbestimmung, nie Lösch-Kandidaten; Default: `edgeTypes` — PRD E34) und `authoritativeForSources` (**Antrag**, für fremde Quellen schliessen zu dürfen, oder `["*"]`; wirksam erst nach explizitem Bestätigungsdialog beim Import, nie aus der Datei selbst; fehlt oder unbestätigt: nur `meta.source` — PRD E37/E46).
- **`schema`**: verwendete Registry-Teilmenge mit vollständigen Deklarationen (`from`/`to`, `identityProps`, `props` inkl. Referenz-Properties).
- **`nodes`**: `id`, `type`, `label` (Pflicht; `label` ist der kanonische Default-Anzeigename, PRD FR-4.2b), optional `props` — nur JSON-Skalare (`string`/`number`/`boolean`/`null`); Arrays und verschachtelte Objekte sind unzulässig (PRD FR-4.5), Referenz-Properties tragen Knoten-IDs als Strings.
- **`edges`**: `type`, `source`, `target` (Pflicht; `source`/`target` sind Knoten-ID-Strings), optional `props`. Nur den Primärfakt liefern — implizierte Kanten (`implies`) materialisiert der Import (PRD FR-4.8).

## Dateikonvention

Export als `crawl-<quelle>-<YYYYMMDD-HHMM>-<id8>.json` (`<id8>` = Identitäts-Kurzhash über Scope- plus Beobachtungs-Fingerprint — disjunkte gleich-minutige Läufe kollidieren so nie im Dateinamen); historisierte, kollisionsfreie Ablage unter `data/<tenant>/sources/` (PRD FR-6.5). Der Dateiname ist Konvention; massgeblich für die Import-Identität ist allein `meta`.
