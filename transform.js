const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, '..', 'protected', 'personen-all-2.json');
const OUTPUT_PATH = path.join(__dirname, 'data.generated.json');

function getDE(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return obj.german || '';
}

function transform(data) {
  const personen = Array.isArray(data.personen) ? data.personen : [];

  const persons = [];
  const orgMap = new Map(); // id -> label (DE)
  const links = [];
  const linkSet = new Set(); // dedupe key s>t

  const personIdSet = new Set(personen.filter(p => p && p.id).map(p => String(p.id)));

  function pushLink(s, t) {
    const S = String(s), T = String(t);
    if (!S || !T || S === T) return;
    const key = `${S}>${T}`;
    if (!linkSet.has(key)) { linkSet.add(key); links.push({ source: S, target: T }); }
  }

  for (const p of personen) {
    if (!p || !p.id) continue;
    const id = String(p.id);
    const fullName = [p.givenName, p.surname].filter(Boolean).join(' ');
    const label = fullName || id;
    const email = p.email || undefined;
    const salutation = p.salutation || undefined;
    const hasSupervisor = !!(p.manager && p.manager.id && personIdSet.has(String(p.manager.id)));

    const personOut = { id, label };
    if (email) personOut.email = email;
    if (salutation) personOut.salutation = salutation;
    if (hasSupervisor) personOut.hasSupervisor = true;
    persons.push(personOut);

    // Person -> Person (manager)
    if (p.manager && p.manager.id && personIdSet.has(String(p.manager.id))) {
      pushLink(String(p.manager.id), id);
    }

    // Org hierarchy
    const hier = Array.isArray(p.hierarchy) ? p.hierarchy : [];
    const orgIds = [];
    for (const h of hier) {
      if (!h || !h.id) continue;
      const oid = String(h.id);
      const lbl = getDE(h.label) || getDE(h.name) || '';
      if (!orgMap.has(oid)) orgMap.set(oid, lbl || oid);
      orgIds.push(oid);
      // Person -> Org membership at each level
      pushLink(id, oid);
    }
    // Org parent chain O[i] -> O[i+1]
    for (let i = 0; i + 1 < orgIds.length; i++) {
      pushLink(orgIds[i], orgIds[i + 1]);
    }
  }

  const orgs = Array.from(orgMap.entries()).map(([id, label]) => ({ id, label }));
  return { persons, orgs, links };
}

function main() {
  try {
    const raw = fs.readFileSync(INPUT_PATH, 'utf8');
    const data = JSON.parse(raw);
    const graph = transform(data);
    function writeArray(arr, indent) {
      if (!Array.isArray(arr) || arr.length === 0) return '[]';
      const pad = ' '.repeat(indent);
      const padInner = ' '.repeat(indent + 2);
      const lines = arr.map(o => `${padInner}${JSON.stringify(o)}`);
      return `[\n${lines.join(',\n')}\n${pad}]`;
    }
    const out = `{
  "persons": ${writeArray(graph.persons, 2)},
  "orgs": ${writeArray(graph.orgs, 2)},
  "links": ${writeArray(graph.links, 2)}
}\n`;
    fs.writeFileSync(OUTPUT_PATH, out, 'utf8');
    console.log(`Wrote ${graph.persons.length} persons, ${graph.orgs.length} orgs and ${graph.links.length} links to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('Transform failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
