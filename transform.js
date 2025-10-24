const fs = require('fs');
const path = require('path');

const INPUT_PATH = path.join(__dirname, '..', 'protected', 'personen-all-2.json');
const OUTPUT_PATH = path.join(__dirname, 'data.generated.json');

function getLangValue(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return obj.german || obj.english || obj.french || obj.italian || '';
}

function buildGroup(person) {
  const dept = person.department && (person.department.name || person.department.nameAbbr);
  if (dept) return getLangValue(dept);
  const div = person.division && (person.division.name || person.division.nameAbbr);
  if (div) return getLangValue(div);
  const org = person.organization && (person.organization.name || person.organization.nameAbbr);
  if (org) return getLangValue(org);
  return 'Unknown';
}

function transform(data) {
  const personen = Array.isArray(data.personen) ? data.personen : [];

  const nodes = [];
  const links = [];

  const idSet = new Set();
  const managerCount = new Map();

  for (const p of personen) {
    if (!p || !p.id) continue;
    idSet.add(p.id);
  }

  for (const p of personen) {
    const mgrId = p && p.manager && p.manager.id;
    if (mgrId && idSet.has(mgrId)) {
      managerCount.set(mgrId, (managerCount.get(mgrId) || 0) + 1);
    }
  }

  // Build links first and count degrees (appearances in links as source or target)
  const degree = new Map();
  function inc(id) { const k = String(id); degree.set(k, (degree.get(k) || 0) + 1); }

  for (const p of personen) {
    if (!p || !p.id) continue;
    const mgrId = p.manager && p.manager.id;
    if (mgrId && idSet.has(mgrId)) {
      const s = String(mgrId);
      const t = String(p.id);
      if (s !== t) {
        links.push({ source: s, target: t });
        inc(s);
        inc(t);
      }
    }
  }

  // Now build nodes with isBasis computed as degree == 1
  for (const p of personen) {
    if (!p || !p.id) continue;
    const fullName = [p.givenName, p.surname].filter(Boolean).join(' ');
    const funcLabel = getLangValue(p.function);
    const label = fullName || funcLabel || p.id;
    const group = buildGroup(p);
    const id = String(p.id);
    const deg = degree.get(id) || 0;
    const isBasis = (deg === 1);
    nodes.push({ id, label, group, isBasis });
  }

  // Link building moved above to count degrees as well

  {
    const seen = new Set();
    const unique = [];
    for (const l of links) {
      const s = String(l.source);
      const t = String(l.target);
      const key = `${s}>${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ source: s, target: t });
    }
    return { nodes, links: unique };
  }
}

function main() {
  try {
    const raw = fs.readFileSync(INPUT_PATH, 'utf8');
    const data = JSON.parse(raw);
    const graph = transform(data);
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(graph, null, 2), 'utf8');
    console.log(`Wrote ${graph.nodes.length} nodes and ${graph.links.length} links to ${OUTPUT_PATH}`);
  } catch (err) {
    console.error('Transform failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
