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

  // Build org hierarchy from children relationships
  for (const oe of oes) {
    if (!oe || !oe.id || !Array.isArray(oe.children)) continue;
    const parentId = String(oe.id);
    for (const childId of oe.children) {
      if (!childId) continue;
      const cid = String(childId);
      // Parent -> Child link
      pushLink(parentId, cid);
    }
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
    const email = (p.contactInformation && p.contactInformation.email) || undefined;
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

    // Person -> Org membership
    // Use hierarchy field (single OE ID) as primary membership
    if (p.hierarchy) {
      const oid = String(p.hierarchy);
      if (orgMap.has(oid)) {
        pushLink(id, oid);
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
