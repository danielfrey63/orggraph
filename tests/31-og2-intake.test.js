import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTenantStore, openExistence } from '../src/sections/23-og2-store.js';
import { importSnapshot } from '../src/sections/26-og2-import.js';
import { validateView } from '../src/sections/27-og2-path.js';
import { resolveRingGroup } from '../src/sections/29-og2-app.js';
import {
  parseListText, buildIdentityResolver, listSourceId, containerNodeOf, priorEdgeSources,
  listEdgeTypes, existingTargets, buildListSnapshot, extendPathWithRing,
} from '../src/sections/31-og2-intake.js';

// E74 — in-app list intake. The committed registry is the data-level fixture
// (E14): the generic Attribut/hatAttribut carrier and the groupProp
// capability are registry entries, never engine code (NFR-5).
const registry = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'registry.json'), 'utf8'));

const YES = {
  confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: [] }),
  confirmJoin: () => true,
  confirmGate: () => true,
  confirmDestructive: () => true,
  confirmAuthority: () => true,
};

const BASE = {
  meta: {
    source: 'stock', crawledAt: '2026-01-01T12:00:00Z', snapshot: '20260101-1200', registryVersion: registry.version,
    scope: { nodeTypes: ['Person', 'OE'], edgeTypes: ['mitgliedIn'] },
  },
  schema: { nodeTypes: { Person: registry.nodeTypes.Person, OE: registry.nodeTypes.OE }, edgeTypes: { mitgliedIn: registry.edgeTypes.mitgliedIn } },
  nodes: [
    { id: 'p1', type: 'Person', label: 'Anna Boss', props: { email: 'Anna.Boss@x.ch' } },
    { id: 'p2', type: 'Person', label: 'Ben Dev', props: { email: 'ben.dev@x.ch' } },
    { id: 'p3', type: 'Person', label: 'Cara Lead', props: {} },
    { id: 'p4', type: 'Person', label: 'Cara Lead', props: {} },
    { id: 'o1', type: 'OE', label: 'Amt', props: {} },
  ],
  edges: [{ type: 'mitgliedIn', source: 'p1', target: 'o1' }],
};

const stockStore = () => {
  const store = createTenantStore();
  const res = importSnapshot(store, registry, BASE, YES);
  expect(res.status).toBe('imported');
  return store;
};

describe('E74 — list parsing', () => {
  const single = (text, stem) => {
    const { lists, header } = parseListText(text, stem);
    expect(lists).toHaveLength(1);
    return { ...lists[0], header };
  };

  it('reads one identifier per line, skips blanks and comments, BOM-safe', () => {
    const { rows, category, header, kind } = single('﻿a@x.ch\n\n# comment\nb@x.ch \n', 'Newsletter');
    expect(rows).toEqual([{ identifier: 'a@x.ch', value: '' }, { identifier: 'b@x.ch', value: '' }]);
    expect(category).toBe('Newsletter');
    expect(kind).toBe('list');
    expect(header).toBe(false);
    expect(parseListText('', 'x')).toEqual({ lists: [], delimiter: null, header: false });
  });

  it('maps the legacy two- and three-column TSV shapes', () => {
    expect(single('a@x.ch\tGold\nb@x.ch\tSilber', 'Stufe').rows).toEqual([
      { identifier: 'a@x.ch', value: 'Gold' }, { identifier: 'b@x.ch', value: 'Silber' },
    ]);
    expect(single('a@x.ch\tKohorte\tVII\n', 'x').rows).toEqual([{ identifier: 'a@x.ch', value: 'VII', category: 'Kohorte' }]);
  });

  it('honours a header row (long form) and Excel-style semicolons with quotes', () => {
    const { rows, header } = single('E-Mail;Wert\n"a@x.ch";"Gold; fein"\nb@x.ch;Silber\n', 'S');
    expect(header).toBe(true);
    expect(rows).toEqual([{ identifier: 'a@x.ch', value: 'Gold; fein' }, { identifier: 'b@x.ch', value: 'Silber' }]);
  });

  it('wide table: the key column beats name columns, boolean columns mean membership, text columns category + value', () => {
    const text = [
      'Name;Nachname;E-Mail;Besucht;Rolle',
      'Minh;Trang Trinh;minhtrang.trinh@sem.admin.ch;FALSCH;',
      'Lionel;Kapff;lionel.kapff@sem.admin.ch;WAHR;Sektionsleiter',
      'Priyanka;Theenesh;priyanka.theenesh@sem.admin.ch;FALSCH;',
      'Eric;Baltisberger;Eric.Baltisberger@sem.admin.ch;WAHR;AG',
      'Helena;Schaer;helena.schaer@sem.admin.ch;WAHR;',
    ].join('\r\n');
    const { lists, header } = parseListText(text, 'export');
    expect(header).toBe(true);
    expect(lists.map((l) => [l.category, l.kind])).toEqual([['Besucht', 'boolean'], ['Rolle', 'value']]);
    expect(lists[0].rows).toEqual([
      { identifier: 'lionel.kapff@sem.admin.ch', value: '' },
      { identifier: 'Eric.Baltisberger@sem.admin.ch', value: '' },
      { identifier: 'helena.schaer@sem.admin.ch', value: '' },
    ]);
    expect(lists[1].rows).toEqual([
      { identifier: 'lionel.kapff@sem.admin.ch', value: 'Sektionsleiter' },
      { identifier: 'Eric.Baltisberger@sem.admin.ch', value: 'AG' },
    ]);
  });

  it('wide table without a key column falls back to the name column; header with names only is a member list', () => {
    const { lists } = parseListText('Person\tAktiv\nAnna Boss\tx\nBen Dev\t\n', 'Team');
    expect(lists).toEqual([{ category: 'Aktiv', kind: 'boolean', rows: [{ identifier: 'Anna Boss', value: '' }] }]);
    const names = parseListText('E-Mail,Name\na@x.ch,Anna\nb@x.ch,Ben\n', 'Kohorte VII');
    expect(names.lists).toEqual([{ category: 'Kohorte VII', kind: 'list', rows: [{ identifier: 'a@x.ch', value: '' }, { identifier: 'b@x.ch', value: '' }] }]);
  });
});

describe('E74 — identity resolution before the export (FR-4.2 identifiers)', () => {
  it('matches exactly on id and props.email case-insensitively, proposes fuzzy hits, keeps duplicates ambiguous', () => {
    const { resolve } = buildIdentityResolver(stockStore(), registry, 'Person');
    expect(resolve('anna.boss@X.CH')).toMatchObject({ status: 'exact', id: 'p1' });
    expect(resolve('p2')).toMatchObject({ status: 'exact', id: 'p2' });
    expect(resolve('ben.dev@x.ch ')).toMatchObject({ status: 'exact', id: 'p2' });
    // local part read as a name: "anna boss" ~ "Anna Boss"
    expect(resolve('anna.boss@other.org')).toMatchObject({ status: 'fuzzy', id: 'p1' });
    // two persons with the same label: never a silent pick
    const cara = resolve('cara.lead@x.ch');
    expect(cara.status).toBe('ambiguous');
    expect(cara.candidates.map((c) => c.id).sort()).toEqual(['p3', 'p4']);
    expect(resolve('zzz@nowhere')).toMatchObject({ status: 'unmatched', candidates: [] });
  });
});

describe('E74 — model helpers', () => {
  it('derives the source id and the E72 container identity', () => {
    expect(listSourceId('SAFe Kohorte VII')).toBe('liste-safe-kohorte-vii');
    expect(listSourceId('2026')).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(containerNodeOf('liste-x', 'Attribut', 'Newsletter', 'Gold', 'kategorie'))
      .toEqual({ id: 'liste-x:Attribut:newsletter--gold', type: 'Attribut', label: 'Gold', props: { kategorie: 'Newsletter' } });
    expect(containerNodeOf('liste-x', 'Attribut', 'Newsletter', '', 'kategorie'))
      .toEqual({ id: 'liste-x:Attribut:newsletter', type: 'Attribut', label: 'Newsletter', props: { kategorie: 'Newsletter' } });
  });

  it('lists the edge types a member type can carry and flags grouped targets', () => {
    const choices = listEdgeTypes(registry, 'Person');
    const att = choices.find((c) => c.edgeType === 'hatAttribut');
    expect(att).toEqual({ edgeType: 'hatAttribut', targetType: 'Attribut', groupProp: 'kategorie' });
    expect(choices.find((c) => c.edgeType === 'besuchte')).toEqual({ edgeType: 'besuchte', targetType: 'Training', groupProp: null });
    expect(choices.some((c) => c.edgeType === 'unterstellt')).toBe(false);
  });

  it('groups ring badges by groupProp and falls back to the type name', () => {
    const decl = registry.nodeTypes.Attribut;
    expect(resolveRingGroup('Attribut', decl, { label: 'Gold', props: { kategorie: 'Newsletter' } })).toBe('Newsletter');
    expect(resolveRingGroup('Attribut', decl, { label: 'Gold', props: {} })).toBe('Attribut');
    expect(resolveRingGroup('Training', registry.nodeTypes.Training, { label: 'X', props: {} })).toBe('Training');
  });
});

describe('E74 — snapshot builder and full-state semantics per list source', () => {
  const list = (store, rows, { source = 'liste-newsletter', at = '2026-09-13T10:00:00Z', value = '' } = {}) => {
    const { resolve, labelOf } = buildIdentityResolver(store, registry, 'Person');
    return buildListSnapshot({
      source, at, registry, rows, category: 'Newsletter', value, edgeType: 'hatAttribut', memberType: 'Person',
      resolveId: (id) => { const r = resolve(id); return r.status === 'exact' || r.status === 'fuzzy' ? r.id : null; },
      labelOf,
      priorSources: priorEdgeSources(store, source, 'hatAttribut'),
    });
  };

  it('builds an enrichment snapshot: no node scope, members as edgeSources, stubs with the stored label', () => {
    const store = stockStore();
    const { snapshot, matched, unmatched } = list(store, [
      { identifier: 'anna.boss@x.ch', value: '' }, { identifier: 'ben.dev@x.ch', value: '' }, { identifier: 'nobody@x.ch', value: '' },
    ]);
    expect(snapshot.meta.scope).toEqual({ nodeTypes: [], edgeTypes: ['hatAttribut'], edgeSources: ['p1', 'p2'] });
    expect(snapshot.meta.snapshot).toBe('20260913-1000');
    expect(matched.map((m) => m.id)).toEqual(['p1', 'p2']);
    expect(unmatched).toEqual([{ identifier: 'nobody@x.ch', value: '', category: 'Newsletter' }]);
    expect(snapshot.nodes).toEqual([
      { id: 'liste-newsletter:Attribut:newsletter', type: 'Attribut', label: 'Newsletter', props: { kategorie: 'Newsletter' } },
      { id: 'p1', type: 'Person', label: 'Anna Boss' },
      { id: 'p2', type: 'Person', label: 'Ben Dev' },
    ]);
    expect(snapshot.edges).toHaveLength(2);
    expect(Object.keys(snapshot.schema.nodeTypes).sort()).toEqual(['Attribut', 'Person']);
  });

  it('imports through the engine; a re-imported shorter list closes the edge of the member who left, other sources stay intact', () => {
    const store = stockStore();
    const first = list(store, [{ identifier: 'p1', value: '' }, { identifier: 'p2', value: '' }]);
    expect(importSnapshot(store, registry, first.snapshot, YES).status).toBe('imported');
    const open = (s, t) => [...store.edges.values()].filter((e) => e.type === 'hatAttribut' && e.source === s && e.target === t && openExistence(e));
    expect(open('p1', 'liste-newsletter:Attribut:newsletter')).toHaveLength(1);
    expect(open('p2', 'liste-newsletter:Attribut:newsletter')).toHaveLength(1);

    // second list of the same source: p2 left — and is still an edgeSource
    // via priorEdgeSources, so its edge closes (full-state semantics).
    const second = list(store, [{ identifier: 'p1', value: '' }], { at: '2026-09-14T10:00:00Z' });
    expect(second.snapshot.meta.scope.edgeSources).toEqual(['p1', 'p2']);
    expect(second.snapshot.nodes.map((n) => n.id)).toContain('p2'); // visited proof stub
    expect(importSnapshot(store, registry, second.snapshot, YES).status).toBe('imported');
    expect(open('p1', 'liste-newsletter:Attribut:newsletter')).toHaveLength(1);
    expect(open('p2', 'liste-newsletter:Attribut:newsletter')).toHaveLength(0);
    // the stock's own facts (other source) are untouched
    const mitglied = [...store.edges.values()].find((e) => e.type === 'mitgliedIn');
    expect(openExistence(mitglied)).toBeTruthy();
    // labels of the stubs never rewrote the stock (E61)
    const p2 = store.nodes.get('p2');
    expect(p2.timelines.get('label').filter((iv) => iv.to === null)[0].value).toBe('Ben Dev');
  });

  it('a second list source with the same category keeps its own facts (source partition E37)', () => {
    const store = stockStore();
    const a = list(store, [{ identifier: 'p1', value: 'Gold' }, { identifier: 'p2', value: 'Silber' }], { source: 'liste-a' });
    expect(importSnapshot(store, registry, a.snapshot, YES).status).toBe('imported');
    const b = list(store, [{ identifier: 'p2', value: '' }], { source: 'liste-b', at: '2026-09-14T10:00:00Z' });
    expect(b.snapshot.meta.scope.edgeSources).toEqual(['p2']); // no prior of liste-b
    expect(importSnapshot(store, registry, b.snapshot, YES).status).toBe('imported');
    const openOf = (s) => [...store.edges.values()].filter((e) => e.type === 'hatAttribut' && e.source === s && openExistence(e)).map((e) => e.target).sort();
    expect(openOf('p2')).toEqual(['liste-a:Attribut:newsletter--silber', 'liste-b:Attribut:newsletter']);
    // existing targets for the dialog: grouped by kategorie, labels resolved
    const targets = existingTargets(store, registry, 'Attribut');
    expect(targets.map((t) => `${t.group}/${t.label}`)).toEqual(['Newsletter/Gold', 'Newsletter/Newsletter', 'Newsletter/Silber']);
  });
});

describe('E74 — typed targets: existing nodes are reused, identity props delivered explicitly', () => {
  it('a value matching an existing role reuses its identity and hatRolle carries kontext: null', () => {
    const store = stockStore();
    const roles = {
      meta: { source: 'stock', crawledAt: '2026-01-02T12:00:00Z', snapshot: '20260102-1200', registryVersion: registry.version,
        scope: { nodeTypes: ['Rolle'], edgeTypes: ['hatRolle'], edgeSources: ['p1'] } },
      schema: { nodeTypes: { Rolle: registry.nodeTypes.Rolle, Person: registry.nodeTypes.Person }, edgeTypes: { hatRolle: registry.edgeTypes.hatRolle } },
      nodes: [{ id: 'stock:Rolle:sektionsleiter', type: 'Rolle', label: 'Sektionsleiter', props: {} }, { id: 'p1', type: 'Person', label: 'Anna Boss' }],
      edges: [{ type: 'hatRolle', source: 'p1', target: 'stock:Rolle:sektionsleiter', props: { kontext: null } }],
    };
    expect(importSnapshot(store, registry, roles, YES).status).toBe('imported');
    const { resolve, labelOf } = buildIdentityResolver(store, registry, 'Person');
    const built = buildListSnapshot({
      source: 'liste-rolle', at: '2026-09-14T08:00:00Z', registry, category: 'Rolle', edgeType: 'hatRolle', memberType: 'Person',
      rows: [{ identifier: 'p2', value: 'Sektionsleiter' }, { identifier: 'p1', value: 'AG' }],
      resolveId: (id) => resolve(id).id || null, labelOf,
      existing: existingTargets(store, registry, 'Rolle'),
    });
    expect(built.snapshot.edges).toEqual([
      { type: 'hatRolle', source: 'p1', target: 'liste-rolle:Rolle:rolle--ag', props: { kontext: null } },
      { type: 'hatRolle', source: 'p2', target: 'stock:Rolle:sektionsleiter', props: { kontext: null } },
    ]);
    expect(importSnapshot(store, registry, built.snapshot, YES).status).toBe('imported');
    expect([...store.nodes.values()].filter((n) => n.type === 'Rolle').map((n) => n.id).sort()).toEqual(['liste-rolle:Rolle:rolle--ag', 'stock:Rolle:sektionsleiter']);
  });
});

describe('E74 — view path extension', () => {
  it('appends the ring hop to a branching or linear person path and validates', () => {
    const branching = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster])';
    const next = extendPathWithRing(branching, 'Person', 'hatAttribut', 'Attribut');
    expect(next).toBe('Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatAttribut--> Attribut[ring])');
    expect(validateView({ path: next, roots: ['__auto__'], depth: 3 }, registry).ok).toBe(true);
    const linear = extendPathWithRing('Person --mitgliedIn--> OE[cluster]', 'Person', 'hatAttribut', 'Attribut');
    expect(linear).toBe('Person (--mitgliedIn--> OE[cluster], --hatAttribut--> Attribut[ring])');
    // no self-hop → no "__auto__" anchor (E45); an explicit root validates
    expect(validateView({ path: linear, roots: ['p1'], depth: 2 }, registry).ok).toBe(true);
    expect(extendPathWithRing('Person', 'Person', 'hatAttribut', 'Attribut')).toBe('Person (--hatAttribut--> Attribut[ring])');
  });

  it('leaves paths alone that already carry the hop or start elsewhere', () => {
    expect(extendPathWithRing('Person (--hatAttribut--> Attribut[ring])', 'Person', 'hatAttribut', 'Attribut')).toBeNull();
    expect(extendPathWithRing('Team <--imTeam-- Person', 'Person', 'hatAttribut', 'Attribut')).toBeNull();
    expect(extendPathWithRing('Personal --x--> Y', 'Person', 'hatAttribut', 'Attribut')).toBeNull();
  });
});
