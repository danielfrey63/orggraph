# OrgGraph

Minimaler statischer D3-Graph ohne Animation. Benutzer kann Startknoten wählen und Such-Tiefe konfigurieren.

## Start

- Öffne `orggraph/index.html` direkt im Browser, oder
- Starte einen simplen Static-Server (z.B. via VS Code Live Server oder `python -m http.server`).

## Nutzung

- Suchfeld: Namen oder ID eingeben (Vorschläge kommen aus `data.json`).
- Tiefe: Anzahl BFS-Stufen ab Startknoten.
- Button „Anzeigen“ rendert den Teilgraphen.

## Datenformat (`data.json`)

```json
{
  "nodes": [
    { "id": "ceo", "label": "CEO", "group": "Executive", "size": 16, "color": "#0ea5e9" }
  ],
  "links": [
    { "source": "ceo", "target": "cto", "distance": 80 }
  ]
}
```

- `id` (string) ist Pflicht.
- `label` wird angezeigt; `group`, `size`, `color` sind optional.
- `links` sind ungerichtet für Nachbarschaftssuche (werden intern symmetrisch verwendet).
- Optional kann `distance` je Kante die Link-Länge steuern.

## Anpassen

- UI/Styles: `index.html`, `style.css`
- Logik/Rendering: `app.js`
- Datenquelle tauschen: `data.json` ersetzen (gleiches Schema).

## Hinweise

- Für große Graphen kann eine Canvas-Variante ergänzt werden.
- Aktuell wird die Force-Simulation einmalig berechnet und gestoppt (keine Animation).
