const fs = require('fs');
const path = require('path');

const DEFAULT_INPUT = 'input.json';
const DEFAULT_OUTPUT = 'data.generated.json';

function parseArgs(args) {
  const result = { input: null, output: null };
  const positional = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--input' || arg === '-i') {
      result.input = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i];
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  
  // Positional arguments: first = input, second = output
  if (positional.length > 0 && !result.input) result.input = positional[0];
  if (positional.length > 1 && !result.output) result.output = positional[1];
  
  return result;
}

function transform(data) {
  const personen = Array.isArray(data.persons) ? data.persons : [];
  const oes = Array.isArray(data.oes) ? data.oes : [];

  const persons = [];
  const orgMap = new Map(); // id -> label
  const links = [];
  const linkSet = new Set(); // dedupe key s>t

  const personIdSet = new Set(personen.filter(p => p && p.id).map(p => String(p.id)));

  function pushLink(s, t) {
    const S = String(s), T = String(t);
    if (!S || !T || S === T) return;
    const key = `${S}>${T}`;
    if (!linkSet.has(key)) { linkSet.add(key); links.push({ source: S, target: T }); }
  }

  // Build org map from oes array
  for (const oe of oes) {
    if (!oe || !oe.id) continue;
    const oid = String(oe.id);
    const label = oe.name || oe.nameAbbr || oid;
    orgMap.set(oid, label);
  }

  // Build child-to-parent map from children relationships
  const oeChildToParent = new Map(); // childId -> parentId
  for (const oe of oes) {
    if (!oe || !oe.id || !Array.isArray(oe.children)) continue;
    const parentId = String(oe.id);
    for (const childId of oe.children) {
      if (!childId) continue;
      const cid = String(childId);
      oeChildToParent.set(cid, parentId);
      // Parent -> Child link
      pushLink(parentId, cid);
    }
  }

  // Build function to get all ancestors of an OE (including itself)
  function getOeAncestors(oeId) {
    const ancestors = [];
    let current = String(oeId);
    const visited = new Set(); // Prevent infinite loops
    
    while (current && orgMap.has(current) && !visited.has(current)) {
      ancestors.push(current);
      visited.add(current);
      current = oeChildToParent.get(current);
    }
    
    return ancestors;
  }

  // Build set of managers (persons who have direct reports)
  const managerSet = new Set();
  for (const p of personen) {
    if (!p || !p.manager) continue;
    const managerId = String(p.manager);
    if (personIdSet.has(managerId)) {
      managerSet.add(managerId);
    }
  }

  // Process persons
  for (const p of personen) {
    if (!p || !p.id) continue;
    const id = String(p.id);
    const fullName = [p.givenName, p.surname].filter(Boolean).join(' ');
    const label = fullName || id;
    const email = (p.contactInformation && p.contactInformation.email) || p.email || undefined;
    const isManager = managerSet.has(id);

    const personOut = { id, label };
    if (email) personOut.email = email;
    // isBasis = true means "is a leaf node" (not a manager)
    if (!isManager) personOut.isBasis = true;
    persons.push(personOut);

    // Person -> Person (manager)
    if (p.manager && personIdSet.has(String(p.manager))) {
      pushLink(String(p.manager), id);
    }

    // Person -> Org membership (collect all direct OE relationships)
    const directOes = new Set();
    
    // 1. Primary hierarchy (most specific)
    if (p.hierarchy) {
      directOes.add(String(p.hierarchy));
    }
    
    // 2. Division
    if (p.division) {
      directOes.add(String(p.division));
    }
    
    // 3. Department
    if (p.department) {
      directOes.add(String(p.department));
    }
    
    // 4. Organization (most general)
    if (p.organization) {
      directOes.add(String(p.organization));
    }
    
    // For each direct OE, add links to it AND all its ancestors
    const allOes = new Set();
    for (const oid of directOes) {
      if (orgMap.has(oid)) {
        const ancestors = getOeAncestors(oid);
        ancestors.forEach(ancestorId => allOes.add(ancestorId));
      }
    }
    
    // Create links for all OE relationships (direct + ancestors)
    for (const oid of allOes) {
      pushLink(id, oid);
    }
  }
  
  // Add persons from oe.persons and oe.overview arrays (explicit membership) + ancestors
  for (const oe of oes) {
    if (!oe || !oe.id) continue;
    const oid = String(oe.id);
    if (!orgMap.has(oid)) continue;
    
    // Process oe.persons array if it exists
    if (Array.isArray(oe.persons)) {
      for (const personId of oe.persons) {
        if (!personId) continue;
        const pid = String(personId);
        if (personIdSet.has(pid)) {
          // Link to this OE and all its ancestors
          const ancestors = getOeAncestors(oid);
          ancestors.forEach(ancestorId => pushLink(pid, ancestorId));
        }
      }
    }
    
    // Process oe.overview array if it exists
    if (Array.isArray(oe.overview)) {
      for (const personId of oe.overview) {
        if (!personId) continue;
        const pid = String(personId);
        if (personIdSet.has(pid)) {
          // Link to this OE and all its ancestors
          const ancestors = getOeAncestors(oid);
          ancestors.forEach(ancestorId => pushLink(pid, ancestorId));
        }
      }
    }
  }

  const orgs = Array.from(orgMap.entries()).map(([id, label]) => ({ id, label }));
  return { persons, orgs, links };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input || DEFAULT_INPUT;
  const outputPath = args.output || DEFAULT_OUTPUT;
  
  // Show help if requested
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: node transform.js [options] [input] [output]

Options:
  -i, --input <file>   Input JSON file (default: ${DEFAULT_INPUT})
  -o, --output <file>  Output JSON file (default: ${DEFAULT_OUTPUT})
  -h, --help           Show this help message

Positional arguments:
  input                Input file (same as --input)
  output               Output file (same as --output)

Examples:
  node transform.js input.json output.json
  node transform.js --input source.json --output data.json
  node transform.js -i source.json -o data.json
`);
    process.exit(0);
  }
  
  try {
    const raw = fs.readFileSync(inputPath, 'utf8');
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
    fs.writeFileSync(outputPath, out, 'utf8');
    console.log(`Wrote ${graph.persons.length} persons, ${graph.orgs.length} orgs and ${graph.links.length} links to ${outputPath}`);
  } catch (err) {
    console.error('Transform failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
