import { describe, it, expect } from 'vitest';
import { parsePathExpression, pathStations, visibleTypesOf, validateView, validateViews } from '../src/sections/27-og2-path.js';

// Type names are fixture data (E14, NFR-5 exception).
const REGISTRY = {
  version: '1',
  nodeTypes: { Person: { props: { pensum: {} } }, OE: {}, Rolle: {}, Firma: {}, Projekt: {} },
  edgeTypes: {
    berichtetAn: { from: 'Person', to: 'Person', props: {} },
    mitgliedIn: { from: 'Person', to: 'OE', props: {} },
    unterstellt: { from: 'OE', to: 'OE', props: {} },
    hatRolle: { from: 'Person', to: 'Rolle', identityProps: ['kontext'], props: { kontext: { ref: 'Firma', implies: 'arbeitetBei' } } },
    arbeitetBei: { from: 'Person', to: 'Firma', props: {} },
    arbeitetAn: { from: 'Person', to: 'Projekt', props: {} },
  },
};

const START_VIEW_PATH = 'Person (<--berichtetAn-- Person, --mitgliedIn--> OE[cluster] --unterstellt--> OE[cluster], --hatRolle--> Rolle[ring])';

describe('FR-7.1a — path grammar', () => {
  it('parses the start view path (FR-7.4)', () => {
    const root = parsePathExpression(START_VIEW_PATH);
    expect(root.type).toBe('Person');
    expect(root.hops.length).toBe(3);
    expect(root.hops[0]).toMatchObject({ dir: '<--', edgeType: 'berichtetAn', selfHop: true });
    expect(root.hops[1].target.render).toBe('cluster');
    expect(root.hops[1].target.hops[0].target.type).toBe('OE');
    expect(root.hops[2].target.render).toBe('ring:prev'); // [ring] = [ring:prev] (E21)
  });

  it('parses hidden contraction and ring:next', () => {
    const root = parsePathExpression('Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person');
    expect(root.hops[0].target.render).toBe('hidden');
    expect(root.hops[0].target.hops[0].dir).toBe('<--');
    const r2 = parsePathExpression('Person --hatRolle--> Rolle[ring:next] --arbeitetAn--> Projekt');
    expect(r2.hops[0].target.render).toBe('ring:next');
  });

  it('rejects grammar violations', () => {
    expect(() => parsePathExpression('Person <-- berichtetAn Person')).toThrow();
    expect(() => parsePathExpression('Person[banana]')).toThrow(/render/);
    expect(() => parsePathExpression('Person extra')).toThrow(/trailing/);
    expect(() => parsePathExpression('--mitgliedIn--> OE')).toThrow();
    expect(() => parsePathExpression('')).toThrow();
  });

  it('marks self-hops and lists visible types', () => {
    const root = parsePathExpression(START_VIEW_PATH);
    expect(visibleTypesOf(root)).toEqual(new Set(['Person', 'OE', 'Rolle']));
    const hidden = parsePathExpression('Person --mitgliedIn--> OE[hidden] <--mitgliedIn-- Person');
    expect(visibleTypesOf(hidden)).toEqual(new Set(['Person']));
    expect(pathStations(root).length).toBeGreaterThan(1);
  });
});

describe('FR-7.1a — registry-aware view validation', () => {
  it('accepts the start view with __auto__ (one self-hop)', () => {
    const res = validateView({ path: START_VIEW_PATH, roots: ['__auto__'], depth: 3 }, REGISTRY);
    expect(res.errors).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('AK 24 (E45): __auto__ without a self-hop is a configuration error', () => {
    const res = validateView({ path: 'Person --mitgliedIn--> OE', roots: ['__auto__'] }, REGISTRY);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('E45');
  });

  it('rejects unknown types and incompatible hops', () => {
    const unknown = validateView({ path: 'Alien --mitgliedIn--> OE', roots: ['x'] }, REGISTRY);
    expect(unknown.errors.join(' ')).toContain('unknown node type "Alien"');
    const badEdge = validateView({ path: 'Person --fliegtNach--> OE', roots: ['x'] }, REGISTRY);
    expect(badEdge.errors.join(' ')).toContain('unknown edge type');
    // mitgliedIn is Person->OE; OE as from-type is incompatible
    const badHop = validateView({ path: 'OE --mitgliedIn--> OE', roots: ['x'] }, REGISTRY);
    expect(badHop.errors.join(' ')).toContain('no valid from-type');
  });

  it('validates ring attachment resolvability (E21)', () => {
    // ring:prev at the anchor has no preceding visible station
    const bad = validateView({ path: 'Rolle[ring] <--hatRolle-- Person', roots: ['x'] }, REGISTRY);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(' ')).toContain('ring:prev');
    // ring:next with no following visible station
    const bad2 = validateView({ path: 'Person --hatRolle--> Rolle[ring:next]', roots: ['x'] }, REGISTRY);
    expect(bad2.errors.join(' ')).toContain('ring:next');
  });

  it('validates filter references (FR-7.8)', () => {
    const ok = validateView({
      path: START_VIEW_PATH, roots: ['__auto__'],
      filters: { nodes: [{ type: 'Person', prop: 'pensum', op: 'gte', value: 80 }], edges: [{ type: 'hatRolle', prop: 'kontext', op: 'refEq', value: 'f1' }] },
    }, REGISTRY);
    expect(ok.errors).toEqual([]);
    const badProp = validateView({
      path: START_VIEW_PATH, roots: ['__auto__'],
      filters: { nodes: [{ type: 'Person', prop: 'ghost', op: 'eq', value: 1 }] },
    }, REGISTRY);
    expect(badProp.errors.join(' ')).toContain('not declared');
    const refOnScalar = validateView({
      path: START_VIEW_PATH, roots: ['__auto__'],
      filters: { nodes: [{ type: 'Person', prop: 'pensum', op: 'refEq', value: 'x' }] },
    }, REGISTRY);
    expect(refOnScalar.errors.join(' ')).toContain('requires a declared reference prop');
    const typeNotInPath = validateView({
      path: 'Person <--berichtetAn-- Person', roots: ['p1'],
      filters: { nodes: [{ type: 'Projekt', prop: 'label', op: 'exists' }] },
    }, REGISTRY);
    expect(typeNotInPath.errors.join(' ')).toContain('does not occur in the path');
  });

  it('view defaults are validated: known keys and types pass, typos reject (FR-7.5b, AK 102)', () => {
    const base = { path: 'Person <--berichtetAn-- Person', roots: ['p1'] };
    const ok = validateView({
      ...base,
      defaults: {
        attributesOff: ['Rolle::Lead'],
        hiddenCategories: ['Rolle'],
        attributeFocus: true,
        clustersOff: ['o1'],
        asOf: '2026-01-01T00:00:00Z',
        diff: { t1: 'a', t2: 'b' },
      },
    }, REGISTRY);
    expect(ok.ok).toBe(true);
    const unknownKey = validateView({ ...base, defaults: { attributFocus: true } }, REGISTRY);
    expect(unknownKey.ok).toBe(false);
    expect(unknownKey.errors.join(' ')).toContain('unknown defaults key "attributFocus"');
    const wrongType = validateView({ ...base, defaults: { hiddenCategories: 'Team' } }, REGISTRY);
    expect(wrongType.ok).toBe(false);
    expect(wrongType.errors.join(' ')).toContain('hiddenCategories must be an array of strings');
    const badDiff = validateView({ ...base, defaults: { diff: { t1: 'a' } } }, REGISTRY);
    expect(badDiff.ok).toBe(false);
    expect(badDiff.errors.join(' ')).toContain('defaults.diff');
    const notObject = validateView({ ...base, defaults: [] }, REGISTRY);
    expect(notObject.ok).toBe(false);
    expect(notObject.errors.join(' ')).toContain('defaults must be an object');
  });

  it('validateViews: invalid views are rejected with reasons; zero valid views detected', () => {
    const { valid, rejected, anyValid } = validateViews({
      Gut: { path: 'Person <--berichtetAn-- Person', roots: ['p1'] },
      Kaputt: { path: 'Person --nixDa--> OE', roots: ['x'] },
    }, REGISTRY);
    expect(Object.keys(valid)).toEqual(['Gut']);
    expect(rejected.Kaputt.length).toBeGreaterThan(0);
    expect(anyValid).toBe(true);
    const none = validateViews({ Kaputt: { path: 'Alien', roots: ['x'] } }, REGISTRY);
    expect(none.anyValid).toBe(false);
    expect(none.rejected.Kaputt.length).toBeGreaterThan(0);
  });
});
