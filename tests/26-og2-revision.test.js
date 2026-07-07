import { describe, it, expect, beforeEach } from 'vitest';
import { canonicalJson } from '../src/sections/21-og2-util.js';
import { createTenantStore, nodeOpenNow, openExistence, edgeKeyOf } from '../src/sections/23-og2-store.js';
import {
  importSnapshot, reviseImport, compensateRevisionPosition,
  acknowledgeRevisionPosition, validateJournalFormat, applyPrecedenceToConflicts,
} from '../src/sections/26-og2-import.js';
import { recordStandAt } from '../src/sections/23-og2-store.js';

// Import revision (FR-6.9b/E68): full-delta rollback, dependency groups,
// rest-list exits, journal format. Type names in fixtures are data-level
// illustration (PRD E14) — never an engine-code contract.
const REGISTRY = {
  version: '1',
  nodeTypes: {
    Person: { props: { email: {}, pensum: {} } },
    OE: { props: {} },
    Rolle: { props: {} },
    Firma: { props: {} },
  },
  edgeTypes: {
    berichtetAn: { from: 'Person', to: 'Person', props: { note: {} } },
    mitgliedIn: { from: 'Person', to: 'OE', props: {} },
    unterstellt: { from: 'OE', to: 'OE', props: {} },
    hatRolle: {
      from: 'Person', to: 'Rolle', identityProps: ['kontext'],
      props: { kontext: { ref: 'Firma', implies: 'arbeitetBei' } },
    },
    arbeitetBei: { from: 'Person', to: 'Firma', props: {} },
  },
};

const crawledAtOf = (stamp) =>
  `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:00Z`;

const mkSnap = (source, stamp, scope, nodes, edges, extraMeta = {}) => ({
  meta: { source, crawledAt: crawledAtOf(stamp), snapshot: stamp, registryVersion: '1', scope, ...extraMeta },
  schema: { nodeTypes: {}, edgeTypes: {} },
  nodes, edges,
});

const FULL_SCOPE = { nodeTypes: ['Person', 'OE'], edgeTypes: ['berichtetAn', 'mitgliedIn', 'unterstellt'] };

const YES = {
  confirmSourceRegistration: () => ({ ok: true, moveOutEdgeTypes: ['mitgliedIn'] }),
  confirmJoin: () => true,
  confirmGate: () => true,
  confirmDestructive: () => true,
  confirmAuthority: () => true,
};

const baseNodes = () => [
  { id: 'p1', type: 'Person', label: 'Boss', props: { email: 'boss@x.ch', pensum: 100 } },
  { id: 'p2', type: 'Person', label: 'Dev', props: { pensum: 80 } },
  { id: 'p3', type: 'Person', label: 'Lead', props: {} },
  { id: 'o1', type: 'OE', label: 'Firma AG', props: {} },
  { id: 'o2', type: 'OE', label: 'IT', props: {} },
];
const baseEdges = () => [
  { type: 'berichtetAn', source: 'p2', target: 'p1' },
  { type: 'berichtetAn', source: 'p3', target: 'p1' },
  { type: 'mitgliedIn', source: 'p2', target: 'o2' },
  { type: 'unterstellt', source: 'o2', target: 'o1' },
];

// Canonical stand of the pure DATA layer (nodes + edges) — the strongest
// possible "timelines equal the pre-import stand" assertion for AK 58.
const dataStand = (store) => canonicalJson({
  nodes: [...store.nodes.entries()].map(([id, n]) => [id, n.type, [...n.timelines.entries()], n.existence]),
  edges: [...store.edges.entries()].map(([k, e]) => [k, e.identityProps, [...e.timelines.entries()], e.existence, e.projected]),
});

const T1 = '20260101-1200';
const T2 = '20260201-1200';
const T3 = '20260301-1200';

// The faulty import (forgotten `excluded`): closes p3 (with cascade), creates
// p9, changes p2.pensum — destructive AND constructive parts.
const faultySnap = () => {
  const nodes = baseNodes().filter((n) => n.id !== 'p3');
  nodes.find((n) => n.id === 'p2').props.pensum = 60;
  nodes.push({ id: 'p9', type: 'Person', label: 'Geist', props: { pensum: 50 } });
  const edges = baseEdges().filter((e) => e.source !== 'p3');
  edges.push({ type: 'berichtetAn', source: 'p9', target: 'p1' });
  return mkSnap('hrm', T2, FULL_SCOPE, nodes, edges);
};

let store;
beforeEach(() => {
  store = createTenantStore();
  const res = importSnapshot(store, REGISTRY, mkSnap('hrm', T1, FULL_SCOPE, baseNodes(), baseEdges()), YES);
  expect(res.status).toBe('imported');
});

describe('AK 86 — journal format (FR-6.9b)', () => {
  it('persists the normative field set for destructive and constructive positions', () => {
    const res = importSnapshot(store, REGISTRY, faultySnap(), YES);
    expect(res.status).toBe('imported');
    const entry = [...store.snapshots.values()].find((e) => e.stamp === T2);
    expect(validateJournalFormat(entry)).toEqual([]);
    const kinds = new Set(entry.journal.map((p) => p.deltaKind));
    // constructive: created + value change; destructive: withdrawal + closes
    expect(kinds.has('created')).toBe(true);
    expect(kinds.has('value-change')).toBe(true);
    expect(kinds.has('provenance-withdrawal')).toBe(true);
    expect(kinds.has('node-close')).toBe(true);
    expect(kinds.has('cascade-close')).toBe(true);
    // dependency group: node close and its cascade share a group id (E35)
    const close = entry.journal.find((p) => p.deltaKind === 'node-close');
    const cascade = entry.journal.find((p) => p.deltaKind === 'cascade-close');
    expect(close.groupId).toBe(cascade.groupId);
    // provenance delta present where provenance changed
    const withdrawal = entry.journal.find((p) => p.deltaKind === 'provenance-withdrawal');
    expect(withdrawal.provDelta).toEqual({ source: 'hrm', from: T1, to: null });
  });

  it('flags journals missing normative fields', () => {
    const errors = validateJournalFormat({ journal: [{ posId: 'p1', deltaKind: 'created', status: 'offen' }] });
    expect(errors.some((e) => e.includes('identityKey'))).toBe(true);
    expect(errors.some((e) => e.includes('provDelta'))).toBe(true);
    expect(errors.some((e) => e.includes('preconditions'))).toBe(true);
  });
});

describe('AK 58 — full revision restores the pre-import stand', () => {
  it('takes back the FULL delta and frees the identity for a deliberate re-import', () => {
    const before = dataStand(store);
    const res = importSnapshot(store, REGISTRY, faultySnap(), YES);
    expect(res.status).toBe('imported');
    expect(dataStand(store)).not.toBe(before);
    const importKey = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T2);

    const rev = reviseImport(store, REGISTRY, importKey);
    expect(rev.status).toBe('revised');
    expect(rev.revisionStatus).toBe('revidiert');
    expect(rev.restList).toEqual([]);
    // exact pre-import stand: closed identity open again, created identity
    // removed, changed property value back — byte-identical data layer.
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(true);
    expect(store.nodes.has('p9')).toBe(false);
    expect(dataStand(store)).toBe(before);

    // re-import of the revised snapshot is NOT a silent no-op
    const again = importSnapshot(store, REGISTRY, faultySnap(), YES);
    expect(again.status).toBe('imported');
    expect(again.report.warnings.some((w) => w.includes('revised'))).toBe(true);
  });

  it('a corrected retry after the revision is its own import identity', () => {
    importSnapshot(store, REGISTRY, faultySnap(), YES);
    const importKey = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T2);
    reviseImport(store, REGISTRY, importKey);
    // corrected retry: same minute, excluded declared -> own identity (E36)
    const nodes = baseNodes();
    nodes.find((n) => n.id === 'p2').props.pensum = 60;
    const corrected = mkSnap('hrm', T2, {
      ...FULL_SCOPE, excluded: ['p3'], traversalEdgeTypes: ['berichtetAn'],
    }, nodes.filter((n) => n.id !== 'p3'), baseEdges().filter((e) => e.source !== 'p3'));
    const res = importSnapshot(store, REGISTRY, corrected, YES);
    expect(res.status).toBe('imported');
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(true); // excluded: protected
  });
});

describe('AK 64 — partial revision and shared projection', () => {
  it('(a) leaves the entry partially revised, consumed, and completes after the blocker is resolved', () => {
    const before = dataStand(store);
    importSnapshot(store, REGISTRY, faultySnap(), YES);
    const keyT2 = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T2);
    // a younger import of the same source changes p2 further -> the T2
    // positions on p2 (and confirmations on the rest) deviate since then
    const nodes3 = baseNodes().filter((n) => n.id !== 'p3');
    nodes3.find((n) => n.id === 'p2').props.pensum = 70;
    nodes3.push({ id: 'p9', type: 'Person', label: 'Geist', props: { pensum: 50 } });
    const edges3 = baseEdges().filter((e) => e.source !== 'p3');
    edges3.push({ type: 'berichtetAn', source: 'p9', target: 'p1' });
    const res3 = importSnapshot(store, REGISTRY, mkSnap('hrm', T3, FULL_SCOPE, nodes3, edges3), YES);
    expect(res3.status).toBe('imported');
    const keyT3 = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T3);

    const rev = reviseImport(store, REGISTRY, keyT2);
    expect(rev.status).toBe('partial');
    expect(rev.revisionStatus).toBe('teilrevidiert');
    expect(rev.restList.length).toBeGreaterThan(0);
    expect(rev.restList.every((p) => p.deviation)).toBe(true);
    // rest list is persisted on the entry
    expect(store.snapshots.get(keyT2).revisionAudit.restList.length).toBe(rev.restList.length);
    // re-import of the partially revised snapshot stays excluded (consumed)
    expect(importSnapshot(store, REGISTRY, faultySnap(), YES).status).toBe('rejected');

    // resolve the blockade: revise the younger import first, then repeat —
    // the repeated run retries exclusively the rest list
    expect(reviseImport(store, REGISTRY, keyT3).status).toBe('revised');
    const rev2 = reviseImport(store, REGISTRY, keyT2);
    expect(rev2.status).toBe('revised');
    expect(dataStand(store)).toBe(before);
    // now the re-import is deliberately possible again
    expect(importSnapshot(store, REGISTRY, faultySnap(), YES).status).toBe('imported');
  });

  it('(b) an implied base edge carried by another import stays open with re-projected intervals', () => {
    // stock gets Rolle/Firma via a scope that includes them
    const scopeRF = { nodeTypes: ['Person', 'Rolle', 'Firma'], edgeTypes: ['hatRolle'] };
    const rfNodes = [
      { id: 'p1', type: 'Person', label: 'Boss', props: {} },
      { id: 'r1', type: 'Rolle', label: 'Dev', props: {} },
      { id: 'r2', type: 'Rolle', label: 'Lead', props: {} },
      { id: 'f1', type: 'Firma', label: 'Acme', props: {} },
    ];
    // import A (T2): hatRolle p1->r1 @ f1 -> implies arbeitetBei p1->f1
    const snapA = mkSnap('hrm', T2, scopeRF, rfNodes,
      [{ type: 'hatRolle', source: 'p1', target: 'r1', props: { kontext: 'f1' } }]);
    expect(importSnapshot(store, REGISTRY, snapA, YES).status).toBe('imported');
    // import B (T3, other source): second primary fact onto the same base
    // edge — endpoints r2/f1 stay stock references (no re-delivery, so B does
    // not confirm A's created nodes and A's own group stays revisable)
    const snapB = mkSnap('crm', T3, { nodeTypes: ['Rolle'], edgeTypes: ['hatRolle'] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: {} }],
      [{ type: 'hatRolle', source: 'p1', target: 'r2', props: { kontext: 'f1' } }]);
    expect(importSnapshot(store, REGISTRY, snapB, YES).status).toBe('imported');
    const baseKey = edgeKeyOf({ type: 'arbeitetBei', source: 'p1', target: 'f1', props: {} }, REGISTRY.edgeTypes.arbeitetBei);
    expect(store.edges.get(baseKey).projected).toEqual([{ from: T2, to: null }]);

    const keyA = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T2 && store.snapshots.get(k).source === 'hrm');
    const rev = reviseImport(store, REGISTRY, keyA);
    expect(rev.revisionStatus).toBe('teilrevidiert'); // f1/r-group blocked by B's reference
    // A's own primary fact is gone…
    const edgeAKey = edgeKeyOf({ type: 'hatRolle', source: 'p1', target: 'r1', props: { kontext: 'f1' } }, REGISTRY.edgeTypes.hatRolle);
    expect(store.edges.has(edgeAKey)).toBe(false);
    // …but the shared base edge stays open, re-projected from B's remaining fact
    expect(store.edges.get(baseKey).projected).toEqual([{ from: T3, to: null }]);
  });
});

describe('AK 82 — dependency group skipped as a whole (E35)', () => {
  it('a since-changed edge blocks the rollback of its created endpoint node', () => {
    importSnapshot(store, REGISTRY, faultySnap(), YES);
    const keyT2 = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T2);
    // another source confirms/extends the created edge p9->p1 (join granted)
    const enrich = mkSnap('crm', T3, { nodeTypes: [], edgeTypes: ['berichtetAn'], edgeSources: ['p9'] },
      [{ id: 'p9', type: 'Person', label: 'Geist', props: {} }, { id: 'p1', type: 'Person', label: 'Boss', props: {} }],
      [{ type: 'berichtetAn', source: 'p9', target: 'p1', props: { note: 'extern' } }]);
    expect(importSnapshot(store, REGISTRY, enrich, YES).status).toBe('imported');

    const rev = reviseImport(store, REGISTRY, keyT2);
    expect(rev.revisionStatus).toBe('teilrevidiert');
    // the WHOLE group (node p9 + its created edge) is skipped together:
    // p9 still exists, the edge still exists, both positions on the rest list
    expect(store.nodes.has('p9')).toBe(true);
    expect(nodeOpenNow(store.nodes.get('p9'))).toBe(true);
    const restKeys = rev.restList.map((p) => p.identityKey);
    expect(restKeys).toContain('p9');
    expect(restKeys.some((k) => k.includes('berichtetAn') && k.includes('p9'))).toBe(true);
    // invariant: no valid edge on an invalid endpoint after the revision
    for (const edge of store.edges.values()) {
      for (const iv of edge.existence) {
        if (iv.to !== null) continue;
        expect(nodeOpenNow(store.nodes.get(edge.source))).toBe(true);
        expect(nodeOpenNow(store.nodes.get(edge.target))).toBe(true);
      }
    }
  });
});

describe('AK 67 — rest-list exits (FR-6.9b)', () => {
  // blockade: a foreign source reactivates p3 AFTER the faulty closure
  const blockViaReactivation = () => {
    importSnapshot(store, REGISTRY, faultySnap(), YES);
    const keyT2 = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).stamp === T2);
    const reamp = mkSnap('crm', T3, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p3', type: 'Person', label: 'Lead', props: {} }], []);
    expect(importSnapshot(store, REGISTRY, reamp, YES).status).toBe('imported');
    const rev = reviseImport(store, REGISTRY, keyT2);
    expect(rev.revisionStatus).toBe('teilrevidiert');
    return { keyT2, rev };
  };

  it('(a) repeat succeeds after the blockade is resolved', () => {
    const { keyT2 } = blockViaReactivation();
    const keyT3 = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).source === 'crm');
    expect(reviseImport(store, REGISTRY, keyT3).status).toBe('revised');
    const rev2 = reviseImport(store, REGISTRY, keyT2);
    expect(rev2.status).toBe('revised');
    expect(nodeOpenNow(store.nodes.get('p3'))).toBe(true);
    expect(importSnapshot(store, REGISTRY, faultySnap(), YES).status).toBe('imported');
  });

  it('(b) compensation applies only under machine-checkable preconditions', () => {
    const { keyT2, rev } = blockViaReactivation();
    const entry = store.snapshots.get(keyT2);
    const closePos = entry.journal.find((p) => p.deltaKind === 'node-close' && p.status === 'blockiert');
    // p3 existence: [t1..t2][t3..) — the range (t2,t3) is free, so the
    // compensation re-opens exactly this range, interval-exact (FR-5.2b)
    const res = compensateRevisionPosition(store, REGISTRY, keyT2, closePos.posId);
    expect(res.status).toBe('compensated');
    const p3 = store.nodes.get('p3');
    expect(p3.existence[0]).toMatchObject({ from: T1, to: T3 });
    expect(store.snapshots.get(keyT2).journal.find((p) => p.posId === closePos.posId).status).toBe('kompensiert');
    // a non-closure position is NOT compensable — option disabled
    const withdrawal = entry.journal.find((p) => p.deltaKind === 'provenance-withdrawal' && p.status === 'blockiert');
    const no = compensateRevisionPosition(store, REGISTRY, keyT2, withdrawal.posId);
    expect(no.status).toBe('rejected');
    expect(no.reason).toContain('option disabled');
    expect(rev.restList.length).toBeGreaterThan(0);
  });

  it('(c) acknowledgements end the revision with the identity consumed', () => {
    const { keyT2 } = blockViaReactivation();
    const entry = store.snapshots.get(keyT2);
    for (const p of entry.journal.filter((x) => x.status === 'blockiert')) {
      const res = acknowledgeRevisionPosition(store, keyT2, p.posId, { at: T3 });
      expect(res.status).toBe('acknowledged');
    }
    const done = store.snapshots.get(keyT2);
    expect(done.revisionStatus).toBe('revidiert-quittiert');
    expect(done.revisionAudit.acknowledged.length).toBeGreaterThan(0);
    // end state 2: import identity stays consumed — no re-import
    const again = importSnapshot(store, REGISTRY, faultySnap(), YES);
    expect(again.status).toBe('rejected');
    expect(again.reason).toContain('consumed');
  });
});

describe('AK 73/80 — prospective precedence + audited follow-up operation (FR-5.6)', () => {
  const tieBreak = () => {
    // equal instant, two sources, differing value: 'alpha' wins lexicographically
    const stamp = T2;
    const a = mkSnap('zeta', stamp, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 70 } }], []);
    const b = mkSnap('alpha', stamp, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 90 } }], []);
    expect(importSnapshot(store, REGISTRY, a, YES).status).toBe('imported');
    expect(importSnapshot(store, REGISTRY, b, YES).status).toBe('imported');
    expect(store.conflicts.length).toBe(1);
    expect(store.conflicts[0].winner).toBe('alpha');
  };

  it('AK 73: changing SOURCE_PRECEDENCE leaves existing timelines untouched; entries carry the used stand', () => {
    tieBreak();
    const before = dataStand(store);
    store.precedence = ['zeta', 'alpha', 'hrm'];
    expect(dataStand(store)).toBe(before); // purely prospective
    expect(recordStandAt(store.nodes.get('p1'), T3).props.pensum).toBe(90);
    // the next import resolves by the NEW stand and audits it on its entry
    const c = mkSnap('zeta', T3, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 75 } }], []);
    expect(importSnapshot(store, REGISTRY, c, YES).status).toBe('imported');
    expect(recordStandAt(store.nodes.get('p1'), '20260401-0000').props.pensum).toBe(75);
    const entry = [...store.snapshots.values()].find((e) => e.stamp === T3);
    expect(entry.precedenceUsed).toEqual(['zeta', 'alpha', 'hrm']);
  });

  it('AK 80: the follow-up operation re-decides exactly the tie-breaker intervals, nothing else', () => {
    tieBreak();
    store.precedence = ['zeta', 'alpha', 'hrm']; // zeta now outranks alpha
    const p2Before = canonicalJson([...store.nodes.get('p2').timelines.entries()]);
    const res = applyPrecedenceToConflicts(store, { at: T3 });
    expect(res.status).toBe('applied');
    expect(res.adjusted).toBe(1);
    // exactly the conflicted interval now carries zeta's value…
    expect(recordStandAt(store.nodes.get('p1'), T3).props.pensum).toBe(70);
    // …and the conflict is audited as resolved with the applied precedence
    expect(store.conflicts[0].resolved).toMatchObject({ action: 'adjusted', at: T3, precedence: ['zeta', 'alpha', 'hrm'] });
    // all other timelines unchanged
    expect(canonicalJson([...store.nodes.get('p2').timelines.entries()])).toBe(p2Before);
    // idempotent: a second run has nothing left to adjust
    expect(applyPrecedenceToConflicts(store, { at: T3 })).toMatchObject({ adjusted: 0, confirmed: 0 });
  });

  it('AK 80: a since-overwritten tie-breaker interval is skipped, never recomputed', () => {
    tieBreak();
    // a younger alpha import overwrites the conflicted value first
    const younger = mkSnap('alpha', T3, { nodeTypes: ['Person'], edgeTypes: [] },
      [{ id: 'p1', type: 'Person', label: 'Boss', props: { pensum: 95 } }], []);
    expect(importSnapshot(store, REGISTRY, younger, YES).status).toBe('imported');
    store.precedence = ['zeta', 'alpha'];
    const res = applyPrecedenceToConflicts(store, { at: T3 });
    // the tie-breaker interval [T2..T3) still carries the stand -> adjusted,
    // but the younger open interval stays untouched
    expect(res.adjusted).toBe(1);
    expect(recordStandAt(store.nodes.get('p1'), '20260215-0000').props.pensum).toBe(70);
    expect(recordStandAt(store.nodes.get('p1'), '20260401-0000').props.pensum).toBe(95);
  });

  it('rejects without a configured precedence', () => {
    tieBreak();
    expect(applyPrecedenceToConflicts(store).status).toBe('rejected');
  });
});

describe('AK 71 — repaired same-minute retry after revision (E65)', () => {
  it('overlap check ignores revised imports', () => {
    // enrichment A: visited p2 contributes one edge
    const snapA = mkSnap('dir', T2, { nodeTypes: [], edgeTypes: ['berichtetAn'], edgeSources: ['p2'] },
      [{ id: 'p2', type: 'Person', label: 'Dev', props: {} }, { id: 'p1', type: 'Person', label: 'Boss', props: {} }],
      [{ type: 'berichtetAn', source: 'p2', target: 'p1', props: {} }]);
    expect(importSnapshot(store, REGISTRY, snapA, YES).status).toBe('imported');
    // same-minute retry with differing contribution of the overlapping node
    const snapB = mkSnap('dir', T2, { nodeTypes: [], edgeTypes: ['berichtetAn'], edgeSources: ['p2', 'p3'] },
      [{ id: 'p2', type: 'Person', label: 'Dev', props: {} }, { id: 'p3', type: 'Person', label: 'Lead', props: {} },
       { id: 'p1', type: 'Person', label: 'Boss', props: {} }],
      [{ type: 'berichtetAn', source: 'p3', target: 'p1', props: {} }]);
    const rejected = importSnapshot(store, REGISTRY, snapB, YES);
    expect(rejected.status).toBe('rejected');
    expect(rejected.reason).toContain('E65');
    // revise the faulty run — the same retry now imports
    const keyA = [...store.snapshots.keys()].find((k) => store.snapshots.get(k).source === 'dir');
    expect(reviseImport(store, REGISTRY, keyA).status).toBe('revised');
    expect(importSnapshot(store, REGISTRY, snapB, YES).status).toBe('imported');
  });
});
