import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  migrateTenant, parseAttributeText, containerNodeOf, resolveIdentifier,
  buildPersonIndex, verifyByImport, toUnmatchedCsv, slug, buildTenantEnv,
} from '../../scripts/migrate-legacy.mjs';
import { validateView } from '../../src/sections/27-og2-path.js';

// AK 12 — direction migration test plus E72 container rule, FR-10.4 matching
// and idempotency. Type names come from the committed registry (E14: the
// migration is data-level, not engine code).
const registry = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema', 'registry.json'), 'utf8'));

const cfg = {
  sourceDate: '2026-06-12',
  categories: {
    'ERZ PA': { treatment: 'node', type: 'Gremium', edge: 'imGremium', categoryProp: 'kategorie' },
    'AKROS': { treatment: 'contextRole' },
    'ERZ Rollen Rom': { treatment: 'role' },
    'ERZ Teams Rom': { treatment: 'node', type: 'Team', edge: 'imTeam' },
    'Beschaeftigungsgrad': { treatment: 'property', prop: 'pensum', valueType: 'number' },
  },
};

const legacyData = () => ({
  persons: [
    { id: 'p-1', label: 'Anna Boss', email: 'anna.boss@x.ch', isBasis: false },
    { id: 'p-2', label: 'Ben Dev', email: 'ben.dev@x.ch', isBasis: true },
  ],
  orgs: [
    { id: 'o-1', label: 'Amt' },
    { id: 'o-2', label: 'Abteilung' },
  ],
  links: [
    { source: 'p-1', target: 'p-2' }, // legacy manager->report
    { source: 'o-1', target: 'o-2' }, // legacy parent->child
    { source: 'p-2', target: 'o-2' }, // person->org keeps direction
  ],
});

const migrate = (over = {}) => migrateTenant({
  source: 'legacy-test', cfg, registry, data: legacyData(), attributes: [], mapping: {}, ...over,
});

describe('AK 12 — direction normalization (FR-7.2a/FR-10.3)', () => {
  it('inverts P->P and OE->OE, keeps P->OE', () => {
    const { snapshot } = migrate();
    const edge = (t) => snapshot.edges.find((e) => e.type === t);
    // legacy p-1(manager)->p-2(report) becomes report -> manager
    expect(edge('berichtetAn')).toMatchObject({ source: 'legacy-test:p-2', target: 'legacy-test:p-1' });
    // legacy o-1(parent)->o-2(child) becomes child -> parent
    expect(edge('unterstellt')).toMatchObject({ source: 'legacy-test:o-2', target: 'legacy-test:o-1' });
    expect(edge('mitgliedIn')).toMatchObject({ source: 'legacy-test:p-2', target: 'legacy-test:o-2' });
  });

  it('flips a legacy OE->P link into person-sourced mitgliedIn and counts it', () => {
    const data = legacyData();
    data.links.push({ source: 'o-1', target: 'p-1' });
    const { snapshot, report } = migrate({ data });
    expect(report.links.orgToPersonFlipped).toBe(1);
    expect(snapshot.edges.filter((e) => e.type === 'mitgliedIn').map((e) => e.source))
      .toContain('legacy-test:p-1');
  });
});

describe('E72 — container node = category + value', () => {
  it('same value in different categories yields distinct nodes; empty value falls back to category', () => {
    const a = containerNodeOf('s', 'Gremium', 'ERZ PA', 'CC', 'kategorie');
    const b = containerNodeOf('s', 'Gremium', 'SEM_PM', 'CC', 'kategorie');
    expect(a.id).not.toBe(b.id);
    expect(a.label).toBe('CC');
    expect(a.props.kategorie).toBe('ERZ PA');
    const empty = containerNodeOf('s', 'Gremium', 'ERZ PA', '  ', 'kategorie');
    expect(empty.id).toBe(`s:Gremium:${slug('ERZ PA')}`);
    expect(empty.label).toBe('ERZ PA');
  });

  it('applies the rule end-to-end including hatRolle kontext:null and contextRole', () => {
    const attributes = [
      { category: 'ERZ PA', rows: [{ identifier: 'anna.boss@x.ch', value: 'CC' }, { identifier: 'ben.dev@x.ch', value: '' }] },
      { category: 'ERZ Rollen Rom', rows: [{ identifier: 'anna.boss@x.ch', value: 'Coach' }] },
      { category: 'AKROS', rows: [{ identifier: 'ben.dev@x.ch', value: 'Coach' }] },
    ];
    const { snapshot } = migrate({ attributes });
    const gremien = snapshot.nodes.filter((n) => n.type === 'Gremium');
    expect(gremien.map((g) => g.label).sort()).toEqual(['CC', 'ERZ PA']);
    // Coach from AKROS and Coach from ERZ Rollen Rom stay distinct (E72)
    const rollen = snapshot.nodes.filter((n) => n.type === 'Rolle');
    expect(rollen.length).toBe(2);
    const hatRolle = snapshot.edges.filter((e) => e.type === 'hatRolle');
    const kontexts = hatRolle.map((e) => e.props.kontext).sort();
    expect(kontexts).toEqual([null, `legacy-test:Firma:${slug('AKROS')}`].sort());
    expect(snapshot.nodes.some((n) => n.type === 'Firma' && n.label === 'AKROS')).toBe(true);
  });
});

describe('FR-10.4 — identifier resolution and mapping file', () => {
  const index = buildPersonIndex(legacyData().persons);

  it('matches exact id and exact email case-insensitively', () => {
    expect(resolveIdentifier('p-1', index, {}).person.id).toBe('p-1');
    expect(resolveIdentifier('Anna.Boss@X.ch', index, {}).person.id).toBe('p-1');
  });

  it('fuzzy-matches a close identifier and reports distant ones with suggestions', () => {
    const close = resolveIdentifier('anna.bosss@x.ch', index, {});
    expect(close.person?.id).toBe('p-1');
    expect(close.fuzzy).toBe(true);
    const far = resolveIdentifier('zorro.unbekannt@y.ch', index, {});
    expect(far.unmatched).toBe(true);
  });

  it('auto-matches a single perfect name hit but keeps duplicate perfect hits unmatched', () => {
    const dupIndex = buildPersonIndex([
      { id: 'p-1', label: 'Adrian Kisliuk', email: 'adrian.kisliuk@x.ch' },
      { id: 'p-2', label: 'Adrian Isler', email: 'adrian.isler@x.ch' },
      { id: 'p-3', label: 'Peter Duwe', email: 'peter.duwe@x.ch' },
      { id: 'p-4', label: 'Peter Duwe', email: 'peter.duwe2@x.ch' },
    ]);
    // external mail, exactly one perfect label hit -> auto (FR-10.4 unambiguous)
    const single = resolveIdentifier('adrian.kisliuk@detecon.com', dupIndex, {});
    expect(single.person?.id).toBe('p-1');
    // two perfect hits (duplicate persons) -> human curation
    const dup = resolveIdentifier('peter.duwe@csp-ag.ch', dupIndex, {});
    expect(dup.unmatched).toBe(true);
    expect(dup.suggestions.filter((s) => s.dist === 0).length).toBe(2);
  });

  it('honours the curated mapping file including deliberate null-skips', () => {
    expect(resolveIdentifier('weird-key', index, { 'weird-key': 'p-2' }).person.id).toBe('p-2');
    expect(resolveIdentifier('weird-key', index, { 'weird-key': null }).skipped).toBe(true);
  });

  it('collects unmatched rows into the CSV report', () => {
    const attributes = [{ category: 'ERZ PA', rows: [{ identifier: 'nobody@nowhere.ch', value: 'X' }] }];
    const { unmatched, report } = migrate({ attributes });
    expect(report.unmatchedTotal).toBe(1);
    const csv = toUnmatchedCsv(unmatched);
    expect(csv).toContain('nobody@nowhere.ch,ERZ PA,X');
  });
});

describe('FR-10.2 — parsing, snapshot shape, verification, idempotency', () => {
  it('parses tab, comma and 3-column forms; keeps empty values for E72', () => {
    const tab = parseAttributeText('a@x.ch\tCC\nb@x.ch\t\n', 'ERZ PA');
    expect(tab.rows).toEqual([{ identifier: 'a@x.ch', value: 'CC' }, { identifier: 'b@x.ch', value: '' }]);
    const comma = parseAttributeText('a@x.ch,Weekly Coaching, mit Komma\n', 'Kontakt');
    expect(comma.rows[0].value).toBe('Weekly Coaching, mit Komma');
    const three = parseAttributeText('P001\tBeschäftigungsgrad\t80\n', 'Beschaeftigungsgrad');
    expect(three.category).toBe('Beschäftigungsgrad');
    expect(three.rows[0]).toEqual({ identifier: 'P001', value: '80' });
  });

  it('produces a schema-valid snapshot that the engine imports (E57 stamps, registry subset)', () => {
    const attributes = [{ category: 'Beschaeftigungsgrad', rows: [{ identifier: 'p-1', value: '80' }] }];
    const { snapshot } = migrate({ attributes });
    expect(snapshot.meta.snapshot).toBe('20260612-0000');
    expect(snapshot.meta.crawledAt).toBe('2026-06-12T00:00:00Z');
    expect(snapshot.meta.registryVersion).toBe(registry.version);
    expect(snapshot.nodes.find((n) => n.id === 'legacy-test:p-1').props.pensum).toBe(80);
    expect(Object.keys(snapshot.schema.edgeTypes)).toEqual(snapshot.meta.scope.edgeTypes);
    const verify = verifyByImport(snapshot, registry);
    expect(verify.status, JSON.stringify(verify.problems)).toBe('imported');
    expect(verify.storeNodes).toBe(snapshot.nodes.length);
    expect(verify.storeEdges).toBe(snapshot.edges.length);
  });

  it('is idempotent: same input + mapping => identical snapshot hash', () => {
    const attributes = [{ category: 'ERZ PA', rows: [{ identifier: 'anna.boss@x.ch', value: 'CC' }] }];
    const one = migrate({ attributes });
    const two = migrate({ attributes });
    expect(one.report.snapshotHash).toBe(two.report.snapshotHash);
    expect(JSON.stringify(one.snapshot)).toBe(JSON.stringify(two.snapshot));
  });
});

describe('deliverable tenant env (FR-7.4)', () => {
  it('builds the start view from migrated edge types and validates against the registry', () => {
    const attributes = [
      { category: 'ERZ Rollen Rom', rows: [{ identifier: 'anna.boss@x.ch', value: 'Dev' }] },
      { category: 'ERZ Teams Rom', rows: [{ identifier: 'anna.boss@x.ch', value: 'T1' }] },
    ];
    const { snapshot } = migrate({ attributes });
    const legacyEnv = { GRAPH_START_ID_DEFAULT: 'p-1', TOOLBAR_MANAGEMENT_ACTIVE: true, DATA_URL: './data.json' };
    const env = buildTenantEnv({ source: 'legacy-test', registry, snapshot, legacyEnv });
    const view = env.VIEWS.Start;
    expect(view.roots).toEqual(['__auto__']);
    expect(view.path).toContain('<--berichtetAn-- Person');
    expect(view.path).toContain('OE[cluster]');
    expect(view.path).toContain('--hatRolle--> Rolle[ring]');
    expect(view.path).toContain('--imTeam--> Team[ring]');
    expect(view.path).not.toContain('arbeitetBei'); // projected base edge, no ring
    // registry-aware validation must accept the generated fixture (FR-7.1a)
    const res = validateView(view, registry);
    expect(res.errors).toEqual([]);
    // legacy start id is namespaced; legacy-only keys are not carried over
    expect(env.GRAPH_START_ID_DEFAULT).toBe('legacy-test:p-1');
    expect(env.TOOLBAR_MANAGEMENT_ACTIVE).toBe(true);
    expect(env.DATA_URL).toBeUndefined();
  });

  it('carries hidden subtree roots over, namespaced, dropping unknown ids (FR-7.4)', () => {
    const { snapshot } = migrate({ attributes: [] });
    const legacyEnv = { LEGEND_HIDDEN_ROOTS_DEFAULT: ['p-1', 'p-ghost'] };
    const env = buildTenantEnv({ source: 'legacy-test', registry, snapshot, legacyEnv });
    expect(env.LEGEND_HIDDEN_ROOTS_DEFAULT).toEqual(['legacy-test:p-1']);
    // absent in the legacy env -> absent in the fixture
    const none = buildTenantEnv({ source: 'legacy-test', registry, snapshot, legacyEnv: {} });
    expect(none.LEGEND_HIDDEN_ROOTS_DEFAULT).toBeUndefined();
  });
});
