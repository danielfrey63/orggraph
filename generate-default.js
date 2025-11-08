// Generate a synthetic default dataset (300 persons, 20 orgs) consistent with app.js expectations
// Usage: node orggraph/generate-default.js
const fs = require('fs');
const path = require('path');

function generateDefaultData(nPersons, nOrgs){
  const orgs = [];
  for (let i=1;i<=nOrgs;i++) {
    orgs.push({ id: `o-${i}`, label: `Org ${i}` });
  }
  const persons = [];
  const links = [];
  // Simple org chain with occasional breaks to emulate a tree
  for (let i=1;i<nOrgs;i++) {
    if (i % 5 !== 0) links.push({ source: `o-${i}`, target: `o-${i+1}` });
  }
  // People distributed round-robin across orgs; simple manager chain per 10 people
  for (let p=1;p<=nPersons;p++) {
    const id = `p-${p}`;
    const email = `p${p}@example.com`;
    persons.push({ id, label: `Person ${p}`, email, hasSupervisor: (p % 10) !== 1 });
    const orgId = `o-${((p-1)%nOrgs)+1}`;
    links.push({ source: id, target: orgId });
    const k = ((p-1)%10)+1;
    if (k !== 1) {
      const mgr = `p-${p-1}`;
      links.push({ source: mgr, target: id });
    }
  }
  return { persons, orgs, links };
}

function main(){
  const outPath = path.join(__dirname, 'data.default.json');
  const data = generateDefaultData(300, 20);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`Wrote default dataset to ${outPath}`);
}

if (require.main === module) main();
