// OrgGraph 2.0 engine — import orchestration (§6.3): diff per FR-5.6,
// gates per FR-5.7/E46/E69/E70, atomic apply per FR-6.9a, delta journal
// per FR-6.9b/E68. All mutations happen on a clone; the real store is only
// swapped after every check passed — abort or runtime failure leaves it
// untouched (E47).
import { canonicalJson, deepClone, instantCompare } from './21-og2-util.js';
import { identityPropsOf, propDeclsOf } from './22-og2-registry.js';
import { closeOpen, createEdgeIdentity, createNodeIdentity, edgeKeyOf, insertHistorical, nodeOpenNow, openExistence, openInterval, startInterval } from './23-og2-store.js';
import { edgeDeletionCandidates, importKeyOf, observationFingerprint, scopeFingerprint } from './24-og2-scope.js';
import { contentHashOf, validateSnapshot } from './25-og2-validate.js';

// Fail-closed default hooks (E71: product HIL dialogs are features; tests and
// the app shell inject real deciders).
export const FAIL_CLOSED_HOOKS = Object.freeze({
  confirmSourceRegistration: () => false,
  confirmJoin: () => false,
  confirmGate: () => false,
  confirmDestructive: () => false,
  confirmAuthority: () => false,
});

export function importSnapshot(store, registry, snapshot, hooks = FAIL_CLOSED_HOOKS) {
  const h = { ...FAIL_CLOSED_HOOKS, ...hooks };
  const meta = snapshot.meta || {};
  const scope = meta.scope || {};
  const t = meta.snapshot;
  const source = meta.source;
  const report = { warnings: [], conflicts: [], counters: null, journal: null };

  // ---- 1) preflight validation (FR-6.8), no mutation ----
  const val = validateSnapshot(snapshot, registry, store);
  report.warnings.push(...val.warnings);
  if (val.errors.length) return { status: 'rejected', reason: 'validation', errors: val.errors, report };

  // ---- 2) snapshot identity: no-op / conflict / chronology (FR-6.9, E36/E65) ----
  const importKey = importKeyOf(meta);
  const hash = contentHashOf(snapshot);
  const existing = store.snapshots.get(importKey);
  if (existing && existing.revisionStatus !== 'revidiert') {
    if (existing.contentHash === hash) {
      return { status: 'noop', reason: 'already imported', priorEntry: summarizeEntry(existing), report };
    }
    return { status: 'rejected', reason: 'identity conflict: same full import identity with different content (E36)', report };
  }
  const scopeFp = scopeFingerprint(scope);
  if (val.kind === 'full') {
    for (const entry of store.snapshots.values()) {
      if (entry.source === source && entry.scopeFingerprint === scopeFp && entry.kind === 'full'
        && entry.revisionStatus !== 'revidiert' && instantCompare(entry.stamp, t) > 0) {
        return { status: 'rejected', reason: `older stamp than newest imported full state of (source, scope) — hard chronology (E65): ${entry.stamp} > ${t}`, report };
      }
    }
  }
  // Same-instant overlap of the same source (E65): overlapping visited sources
  // must contribute identically; revised imports do not count.
  for (const entry of store.snapshots.values()) {
    if (entry.source !== source || entry.stamp !== t || entry.revisionStatus === 'revidiert') continue;
    for (const id of scope.edgeSources || []) {
      const prior = (entry.contributions || {})[id];
      if (prior === undefined) continue;
      const now = contributionHash(id, val, scope);
      if (prior !== now) {
        return { status: 'rejected', reason: `same-instant overlap with differing contribution for visited node "${id}" (E65) — revise the faulty import (FR-6.9b) or use a new instant`, report };
      }
    }
  }

  // ---- 3) source book (E70) ----
  // Cloned immediately: the book may be updated on confirmation, and no
  // mutation may reach the real store before the commit swap (FR-6.9a).
  let book = store.sourceBook.has(source) ? deepClone(store.sourceBook.get(source)) : null;
  if (!book) {
    const dec = h.confirmSourceRegistration({ source, sourceUrl: meta.sourceUrl, harvestSpecVersion: meta.harvestSpecVersion ?? null });
    if (!dec || dec.ok === false) return { status: 'aborted', reason: 'source registration not confirmed (E70)', report };
    book = {
      registeredAt: t,
      harvestSpecVersion: meta.harvestSpecVersion ?? null,
      specless: meta.harvestSpecVersion == null,
      moveOutEdgeTypes: new Set((dec && dec.moveOutEdgeTypes) || []),
    };
  }
  const specMismatch = (book.harvestSpecVersion ?? null) !== (meta.harvestSpecVersion ?? null);
  const moveOutCapable = (edgeType) => book.moveOutEdgeTypes.has(edgeType);
  if (val.kind === 'rooted' && scope.edgeTargets) {
    for (const edgeType of Object.keys(scope.edgeTargets)) {
      if (!moveOutCapable(edgeType)) {
        report.warnings.push(`edgeTargets["${edgeType}"] ignored: edge type has no registered move-out capability for source "${source}" (E70)`);
      }
    }
  }

  // ---- 4) join gate (E66/E69): first contribution to foreign identities ----
  const idRulesStamp = meta.harvestSpecVersion ?? 'none';
  const joins = new Map(); // `${otherSource}|${nodeType}` -> examples
  for (const [id] of val.nodesById) {
    const stock = store.nodes.get(id);
    if (!stock || !nodeOpenNow(stock)) continue;
    const prov = openExistence(stock).provenance || {};
    if (prov[source] !== undefined) continue;
    for (const other of Object.keys(prov)) {
      const grantKey = canonicalJson([source, other, stock.type, idRulesStamp]);
      if (store.joinGrants.has(grantKey)) continue;
      const k = `${other}|${stock.type}`;
      if (!joins.has(k)) joins.set(k, { newSource: source, priorSource: other, nodeType: stock.type, grantKey, count: 0, examples: [] });
      const j = joins.get(k);
      j.count++;
      if (j.examples.length < 3) j.examples.push(id);
    }
  }
  if (joins.size) {
    const ok = h.confirmJoin({ source, joins: [...joins.values()] });
    if (!ok) return { status: 'aborted', reason: 'cross-source join not confirmed (E69) — nothing mutated (FR-6.9a)', report };
  }

  // ---- 5) authority request (E46): request only, never from the file ----
  let authoritySources = null; // null = standard partition (only meta.source)
  let authorityStatus = null;
  if (scope.authoritativeForSources && scope.authoritativeForSources.length) {
    const affected = scope.authoritativeForSources.includes('*') ? '*' : scope.authoritativeForSources;
    const ok = h.confirmAuthority({ source, requested: affected });
    if (ok) { authoritySources = affected; authorityStatus = { requested: affected, confirmed: true, at: t }; }
    else { authorityStatus = { requested: affected, confirmed: false, open: true }; report.warnings.push('authority request left OPEN — imported with standard source partition (E46)'); }
  }
  const partitionAllows = (prov) => {
    if (prov[source] !== undefined) return true;
    if (authoritySources === '*') return Object.keys(prov).length > 0;
    if (Array.isArray(authoritySources)) return Object.keys(prov).some((s) => authoritySources.includes(s));
    return false;
  };

  // ---- 6) build the new stand on a CLONE (atomicity, FR-6.9a) ----
  const work = deepClone(store);
  const journal = [];
  let posCounter = 0;
  const counters = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 };
  const jot = (deltaKind, identityKey, before, after, groupId = null) => {
    journal.push({
      posId: `p${++posCounter}`, identityKey, deltaKind,
      before: before === undefined ? null : before, after: after === undefined ? null : after,
      preconditions: { instant: t }, groupId, status: 'offen',
      audit: { operation: 'import', at: t },
    });
  };
  const mergeCtx = { work, registry, source, t, counters, report, jot };

  // -- delivered nodes --
  // membership is the pre-import stock view (computed in validateSnapshot
  // against the untouched store, FR-5.5a).
  const membership = val.membership;
  const nodeScopeTypes = new Set(scope.nodeTypes || []);
  const candidates = edgeDeletionCandidates(store, scope, membership, moveOutCapable);
  try {
  for (const [id, rec] of val.nodesById) {
    const inNodeScope = nodeScopeTypes.has(rec.type);
    let identity = work.nodes.get(id);
    if (!identity) {
      identity = createNodeIdentity(id, rec.type);
      identity.existence.push({ from: t, to: null, provenance: { [source]: t } });
      setInitialTimelines(identity, rec, mergeCtx);
      work.nodes.set(id, identity);
      counters.e++;
      jot('created', id, null, { label: rec.label, props: rec.props || {} });
      continue;
    }
    const open = openExistence(identity);
    if (open) {
      const before = { ...open.provenance };
      open.provenance[source] = latestInstant(open.provenance[source], t);
      if (before[source] === undefined) jot('provenance-confirm', id, before, { ...open.provenance });
    } else if (inNodeScope) {
      identity.existence.push({ from: t, to: null, provenance: { [source]: t } });
      identity.existence.sort((a, b) => instantCompare(a.from, b.from));
      jot('reactivated', id, null, { at: t });
    } else {
      report.warnings.push(`closed identity "${id}" delivered as out-of-scope stub — not reactivated (E61)`);
      continue;
    }
    mergeRecordProps(identity, rec, inNodeScope, mergeCtx);
  }

  // -- node deletion candidates (only root-free full states, E39) --
  if (membership.nodeDeletionCandidatesAllowed) {
    for (const id of membership.nodeScope) {
      if (val.nodesById.has(id)) continue;
      const identity = work.nodes.get(id);
      const open = identity && openExistence(identity);
      if (!open) continue;
      if (!partitionAllows(open.provenance)) continue;
      const lastConfirm = open.provenance[source];
      if (lastConfirm !== undefined && instantCompare(t, lastConfirm) <= 0) continue; // instant monotonicity (E54)
      withdrawAndMaybeClose(identity, open, authoritySources, mergeCtx);
    }
  }

  // -- delivered edges --
  for (const [key, rec] of val.edgesByKey) {
    const decl = (registry.edgeTypes || {})[rec.type];
    let identity = work.edges.get(key);
    if (!identity) {
      const ipVals = {};
      for (const ip of identityPropsOf(decl)) ipVals[ip] = (rec.props || {})[ip];
      identity = createEdgeIdentity(key, rec.type, rec.source, rec.target, ipVals);
      identity.existence.push({ from: t, to: null, provenance: { [source]: t } });
      setInitialTimelines(identity, rec, mergeCtx, decl);
      work.edges.set(key, identity);
      counters.e++;
      jot('created', key, null, { props: rec.props || {} });
      continue;
    }
    const open = identity.existence.find((iv) => iv.to === null);
    if (open) {
      const before = { ...open.provenance };
      open.provenance[source] = latestInstant(open.provenance[source], t);
      if (before[source] === undefined) jot('provenance-confirm', key, before, { ...open.provenance });
    } else {
      identity.existence.push({ from: t, to: null, provenance: { [source]: t } });
      identity.existence.sort((a, b) => instantCompare(a.from, b.from));
      jot('reactivated', key, null, { at: t });
    }
    mergeRecordProps(identity, rec, true, mergeCtx, decl);
  }

  // -- edge deletion candidates (FR-5.5a(2)) --
  for (const [key] of candidates) {
    if (val.edgesByKey.has(key)) continue;
    const identity = work.edges.get(key);
    const open = identity && identity.existence.find((iv) => iv.to === null);
    if (!open) continue;
    if (!partitionAllows(open.provenance)) continue;
    const lastConfirm = open.provenance[source];
    if (lastConfirm !== undefined && instantCompare(t, lastConfirm) <= 0) continue; // E54 per visited source node
    withdrawEdge(identity, open, authoritySources, mergeCtx);
  }

  // -- implied projection (E33/E52): recompute deterministically --
  recomputeProjections(work, registry);
  } catch (err) {
    if (err instanceof BundleValidationError) {
      return { status: 'rejected', reason: err.message, report };
    }
    throw err;
  }

  // ---- 7) plausibility gate (FR-5.7) with null-denominator rule ----
  const denominators = gateDenominators(store, scope, membership, candidates, source);
  const gate = evaluateGate(counters, denominators);
  const baselineKey = canonicalJson([source, scopeFp]);
  const baseline = store.baselines.get(baselineKey) || { cum: { a: 0, b: 0, c: 0, d: 0 }, denominators };
  const cumulative = {};
  let cumulativeExceeded = false;
  for (const k of ['a', 'b', 'c', 'd']) {
    cumulative[k] = baseline.cum[k] + counters[k];
    const den = baseline.denominators[k] ?? denominators[k];
    if (den > 0 && cumulative[k] / den > 0.2) cumulativeExceeded = true;
  }
  let gateAudit = null;
  if (gate.exceeded.length || cumulativeExceeded) {
    const ok = h.confirmGate({ counters, denominators, exceeded: gate.exceeded, cumulative, cumulativeExceeded });
    if (!ok) return { status: 'aborted', reason: `plausibility gate not confirmed (FR-5.7): ${gate.exceeded.join(', ') || 'cumulative'}`, report };
    gateAudit = { counters: { ...counters }, denominators, exceeded: gate.exceeded, cumulativeExceeded, confirmedAt: t };
  }

  // ---- 8) destructive confirmation (E70 spec mismatch / opt-in fail-safe) ----
  const destructiveCount = counters.a + counters.b + counters.c + counters.d;
  if (destructiveCount > 0 && (specMismatch || store.options.IMPORT_CONFIRM_DESTRUCTIVE)) {
    const ok = h.confirmDestructive({ source, specMismatch, counters: { ...counters } });
    if (!ok) return { status: 'aborted', reason: specMismatch ? 'destructive effects with harvest-spec mismatch not confirmed (E70)' : 'destructive effects not confirmed (IMPORT_CONFIRM_DESTRUCTIVE)', report };
    if (specMismatch) book.harvestSpecVersion = meta.harvestSpecVersion ?? null;
  }

  // ---- 9) commit: registry entry + swap (atomic, FR-6.9a) ----
  const contributions = {};
  for (const id of scope.edgeSources || []) contributions[id] = contributionHash(id, val, scope);
  const entry = {
    importKey, source, stamp: t, scopeFingerprint: scopeFp,
    observationFingerprint: observationFingerprint(scope), kind: val.kind,
    registryVersion: meta.registryVersion, contentHash: hash,
    degraded: val.degraded, journal, gateAudit, authorityStatus,
    precedenceUsed: [...store.precedence], contributions,
    revisionStatus: null,
    canonicalObservations: {
      edgeSources: [...(scope.edgeSources || [])].sort(),
      excluded: [...(scope.excluded || [])].sort(),
      edgeTargets: scope.edgeTargets || {},
    },
  };
  work.snapshots.set(importKey, entry);
  work.sourceBook.set(source, book);
  for (const j of joins.values()) work.joinGrants.add(j.grantKey);
  if (gateAudit) work.baselines.set(baselineKey, { cum: { a: 0, b: 0, c: 0, d: 0 }, denominators });
  else work.baselines.set(baselineKey, { cum: cumulative, denominators: baseline.denominators ?? denominators });

  swapStore(store, work);
  report.counters = { ...counters };
  report.journal = journal;
  return { status: 'imported', report, entry: summarizeEntry(entry) };
}

// ZIP bundles are ONE transaction unit (E55/FR-6.9a): deterministic total
// order, dependency-aware pre-stage within equal instants, dry-run before
// commit, full rollback on any runtime failure.
export function importBundle(store, registry, snapshots, hooks = FAIL_CLOSED_HOOKS, onApplied = null) {
  const ordered = orderBundle(snapshots);
  if (ordered.error) return { status: 'rejected', reason: ordered.error, results: [] };
  const work = deepClone(store);
  const results = [];
  try {
    for (const snap of ordered.list) {
      const res = importSnapshot(work, registry, snap, hooks);
      results.push(res);
      if (res.status === 'rejected' || res.status === 'aborted') {
        return { status: 'rejected', reason: `bundle member failed: ${res.reason}`, results };
      }
      if (onApplied) onApplied(snap, res); // test hook for injected runtime failures (AK 34)
    }
  } catch (err) {
    return { status: 'rejected', reason: `runtime failure during bundle commit — rolled back (E55): ${err.message}`, results };
  }
  swapStore(store, work);
  return { status: 'imported', results };
}

function orderBundle(snapshots) {
  const sorted = [...snapshots].sort((a, b) => {
    const ka = [a.meta.snapshot, a.meta.source, scopeFingerprint(a.meta.scope), observationFingerprint(a.meta.scope), contentHashOf(a)];
    const kb = [b.meta.snapshot, b.meta.source, scopeFingerprint(b.meta.scope), observationFingerprint(b.meta.scope), contentHashOf(b)];
    return canonicalJson(ka) < canonicalJson(kb) ? -1 : 1;
  });
  // dependency-aware pre-stage within equal instants: producers of nodes that
  // another same-instant snapshot needs as endpoints come first.
  const list = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].meta.snapshot === sorted[i].meta.snapshot) j++;
    const group = sorted.slice(i, j);
    const topo = topoSortGroup(group);
    if (topo.error) return { error: topo.error };
    list.push(...topo.list);
    i = j;
  }
  return { list };
}

function topoSortGroup(group) {
  const provides = group.map((s) => new Set((s.nodes || []).map((n) => n.id)));
  const needs = group.map((s) => {
    const own = new Set((s.nodes || []).map((n) => n.id));
    const need = new Set();
    for (const e of s.edges || []) { if (!own.has(e.source)) need.add(e.source); if (!own.has(e.target)) need.add(e.target); }
    return need;
  });
  const deps = group.map((_, gi) => {
    const d = new Set();
    for (const id of needs[gi]) {
      group.forEach((_, gj) => { if (gi !== gj && provides[gj].has(id)) d.add(gj); });
    }
    return d;
  });
  const list = [];
  const state = new Array(group.length).fill(0); // 0 new, 1 visiting, 2 done
  const visit = (idx) => {
    if (state[idx] === 2) return true;
    if (state[idx] === 1) return false; // cycle
    state[idx] = 1;
    for (const d of deps[idx]) if (!visit(d)) return false;
    state[idx] = 2;
    list.push(group[idx]);
    return true;
  };
  for (let idx = 0; idx < group.length; idx++) {
    if (!visit(idx)) return { error: 'cyclic same-instant dependencies in bundle (E55) — bundle rejected' };
  }
  return { list };
}

// --- merge helpers ---------------------------------------------------------

function setInitialTimelines(identity, rec, ctx, edgeDecl = null) {
  const skip = edgeDecl ? new Set(identityPropsOf(edgeDecl)) : new Set();
  if (rec.label !== undefined) identity.timelines.set('label', [{ from: ctx.t, to: null, value: rec.label, source: ctx.source, instant: ctx.t }]);
  for (const [k, v] of Object.entries(rec.props || {})) {
    if (skip.has(k)) continue; // identityProps are identity-fixed, not versioned (E53)
    identity.timelines.set(`props.${k}`, [{ from: ctx.t, to: null, value: v, source: ctx.source, instant: ctx.t }]);
  }
}

function mergeRecordProps(identity, rec, fullStand, ctx, edgeDecl = null) {
  const skip = edgeDecl ? new Set(identityPropsOf(edgeDecl)) : new Set();
  const deliveredKeys = new Set();
  if (rec.label !== undefined && (fullStand || edgeDecl)) { deliveredKeys.add('label'); mergeProp(identity, 'label', rec.label, ctx); }
  for (const [k, v] of Object.entries(rec.props || {})) {
    if (skip.has(k)) continue;
    deliveredKeys.add(`props.${k}`);
    mergeProp(identity, `props.${k}`, v, ctx);
  }
  if (!fullStand) return; // out-of-scope: additive only — missing means nothing (E61)
  // in scope: delivered record = complete record stand — a missing prop owned
  // by THIS source ends (FR-5.6c); foreign-owned props are untouched (E40).
  for (const [prop, tl] of identity.timelines) {
    if (deliveredKeys.has(prop) || prop === 'label') continue;
    const open = openInterval(tl);
    if (open && open.source === ctx.source && instantCompare(ctx.t, open.instant) > 0) {
      closeOpen(tl, ctx.t);
      ctx.counters.b++;
      ctx.jot('prop-end', propKeyOf(identity, prop), { value: open.value, source: open.source }, null);
    }
  }
}

function mergeProp(identity, prop, value, ctx) {
  const { work, source, t, counters, report, jot } = ctx;
  if (!identity.timelines.has(prop)) identity.timelines.set(prop, []);
  const tl = identity.timelines.get(prop);
  const open = openInterval(tl);
  if (!open) {
    const last = tl[tl.length - 1];
    if (!last || instantCompare(t, last.to) >= 0) startInterval(tl, t, value, source);
    else insertHistorical(tl, t, value, source, t);
    return;
  }
  if (open.value === value) {
    if (open.source === source && instantCompare(t, open.instant) > 0) open.instant = t; // confirmation
    return;
  }
  // differing value
  if (open.source === source) {
    if (instantCompare(t, open.instant) > 0) {
      closeOpen(tl, t); startInterval(tl, t, value, source);
      counters.f++;
      jot('value-change', propKeyOf(identity, prop), { value: open.value }, { value });
    } else if (instantCompare(t, open.instant) === 0) {
      // same source, same instant, differing value: validation error (E65) —
      // surfaced as hard error; caller treats a thrown error as rejection.
      throw new BundleValidationError(`same-instant differing contribution of source "${source}" for ${propKeyOf(identity, prop)} (E65)`);
    } else {
      insertHistorical(tl, t, value, source, t);
    }
    return;
  }
  // cross-source: precedence first (FR-5.6)
  const prec = work.precedence;
  if (prec.length && prec.includes(open.source) && prec.includes(source)) {
    if (prec.indexOf(source) > prec.indexOf(open.source)) {
      report.conflicts.push({ kind: 'precedence-discarded', identity: propKeyOf(identity, prop), kept: open.source, discarded: source, instant: t });
      return;
    }
    closeOpen(tl, t) || (tl.splice(tl.indexOf(open), 1)); startInterval(tl, t, value, source);
    counters.f++;
    jot('value-change', propKeyOf(identity, prop), { value: open.value, source: open.source }, { value, source });
    report.conflicts.push({ kind: 'precedence-won', identity: propKeyOf(identity, prop), kept: source, overridden: open.source, instant: t });
    return;
  }
  const cmp = instantCompare(t, open.instant);
  if (cmp > 0) {
    closeOpen(tl, t); startInterval(tl, t, value, source);
    counters.f++;
    jot('value-change', propKeyOf(identity, prop), { value: open.value, source: open.source }, { value, source });
  } else if (cmp === 0) {
    // deterministic tie-breaker: lexicographically smallest source (FR-5.6);
    // always persisted as an OPEN source conflict.
    const winner = source < open.source ? source : open.source;
    work.conflicts.push({ identity: propKeyOf(identity, prop), prop, instant: t, a: { source: open.source, value: open.value }, b: { source, value }, winner });
    report.conflicts.push({ kind: 'tie-breaker', identity: propKeyOf(identity, prop), winner, instant: t });
    if (winner === source) { open.value = value; open.source = source; open.instant = t; }
  } else {
    insertHistorical(tl, t, value, source, t);
  }
}

function propKeyOf(identity, prop) {
  return `${identity.key || identity.id}#${prop}`;
}

function withdrawAndMaybeClose(identity, open, authoritySources, ctx) {
  const { work, source, t, counters, jot } = ctx;
  const groupId = `g-${identity.id}`;
  withdrawProvenance(identity.id, open, authoritySources, ctx, groupId);
  if (Object.keys(open.provenance).length === 0) {
    open.to = t;
    counters.d++;
    jot('node-close', identity.id, { openSince: open.from }, { closedAt: t }, groupId);
    for (const tl of identity.timelines.values()) closeOpen(tl, t);
    // cascade (E35): close all open edges with this node as endpoint
    for (const edge of work.edges.values()) {
      if (edge.source !== identity.id && edge.target !== identity.id) continue;
      const eOpen = edge.existence.find((iv) => iv.to === null);
      if (!eOpen) continue;
      eOpen.to = t;
      counters.c++;
      jot('cascade-close', edge.key, { openSince: eOpen.from }, { closedAt: t }, groupId);
      for (const tl of edge.timelines.values()) closeOpen(tl, t);
    }
  }
}

function withdrawEdge(identity, open, authoritySources, ctx) {
  const { source, t, counters, jot } = ctx;
  const groupId = `g-${identity.key}`;
  withdrawProvenance(identity.key, open, authoritySources, ctx, groupId);
  if (Object.keys(open.provenance).length === 0) {
    open.to = t;
    counters.c++;
    jot('edge-close', identity.key, { openSince: open.from }, { closedAt: t }, groupId);
    for (const tl of identity.timelines.values()) closeOpen(tl, t);
  }
}

function withdrawProvenance(identityKey, open, authoritySources, ctx, groupId) {
  const { source, t, counters, jot } = ctx;
  const toWithdraw = [source];
  if (authoritySources === '*') toWithdraw.push(...Object.keys(open.provenance));
  else if (Array.isArray(authoritySources)) toWithdraw.push(...authoritySources.filter((s) => open.provenance[s] !== undefined));
  for (const s of new Set(toWithdraw)) {
    if (open.provenance[s] === undefined) continue;
    delete open.provenance[s];
    counters.a++;
    jot('provenance-withdrawal', identityKey, { source: s }, null, groupId);
  }
}

// Deterministic re-projection of implied edges (E33/E52): the projected
// contribution of a base edge is the merged union of the validity intervals of
// ALL primary facts implying it; never a closure candidate itself.
export function recomputeProjections(work, registry) {
  for (const edge of work.edges.values()) edge.projected = [];
  const projectedIntervals = new Map(); // implied key -> intervals[]
  for (const edge of work.edges.values()) {
    const decl = (registry.edgeTypes || {})[edge.type];
    if (!decl) continue;
    for (const [propName, pd] of Object.entries(propDeclsOf(decl))) {
      if (!pd.implies || !pd.ref) continue;
      const refValue = edge.identityProps && edge.identityProps[propName] !== undefined
        ? edge.identityProps[propName]
        : openIntervalValue(edge, `props.${propName}`);
      if (refValue == null) continue;
      const impliedDecl = (registry.edgeTypes || {})[pd.implies];
      const impliedKey = edgeKeyOf({ type: pd.implies, source: edge.source, target: refValue, props: {} }, impliedDecl);
      if (!projectedIntervals.has(impliedKey)) projectedIntervals.set(impliedKey, { type: pd.implies, source: edge.source, target: refValue, intervals: [] });
      for (const iv of edge.existence) projectedIntervals.get(impliedKey).intervals.push({ from: iv.from, to: iv.to });
    }
  }
  for (const [key, info] of projectedIntervals) {
    let identity = work.edges.get(key);
    if (!identity) {
      identity = createEdgeIdentity(key, info.type, info.source, info.target, {});
      work.edges.set(key, identity);
    }
    identity.projected = mergeIntervalUnion(info.intervals);
  }
}

function openIntervalValue(edge, prop) {
  const tl = edge.timelines.get(prop);
  const open = tl && openInterval(tl);
  return open ? open.value : null;
}

export function mergeIntervalUnion(intervals) {
  const sorted = [...intervals].sort((x, y) => instantCompare(x.from, y.from));
  const out = [];
  for (const iv of sorted) {
    const prev = out[out.length - 1];
    if (prev && (prev.to === null || instantCompare(iv.from, prev.to) <= 0)) {
      if (prev.to !== null && (iv.to === null || instantCompare(iv.to, prev.to) > 0)) prev.to = iv.to;
    } else out.push({ from: iv.from, to: iv.to });
  }
  return out;
}

// --- gate -------------------------------------------------------------------

function gateDenominators(store, scope, membership, edgeCandidates, source) {
  const nodeDen = membership.nodeScope.size;
  const edgeDen = edgeCandidates.size;
  let propDen = 0;
  for (const id of membership.nodeScope) {
    const n = store.nodes.get(id);
    if (!n) continue;
    for (const tl of n.timelines.values()) {
      const open = openInterval(tl);
      if (open && open.source === source) propDen++;
    }
  }
  let allPropDen = 0;
  let tenantNodeDen = 0;
  for (const n of store.nodes.values()) {
    if (nodeOpenNow(n)) tenantNodeDen++;
    for (const tl of n.timelines.values()) if (openInterval(tl)) allPropDen++;
  }
  // Null-denominator rule (FR-5.7): empty scope denominator in a non-empty
  // tenant counts against the tenant-wide stock instead.
  return {
    a: nodeDen || tenantNodeDen, b: propDen || allPropDen, c: edgeDen,
    d: nodeDen || tenantNodeDen, e: nodeDen || tenantNodeDen, f: allPropDen,
  };
}

function evaluateGate(counters, denominators) {
  const exceeded = [];
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const den = denominators[k];
    if (den > 0 && counters[k] / den > 0.2) exceeded.push(k);
  }
  return { exceeded };
}

// --- misc -------------------------------------------------------------------

class BundleValidationError extends Error {}

function latestInstant(a, b) {
  if (a === undefined) return b;
  return instantCompare(a, b) >= 0 ? a : b;
}

function contributionHash(id, val, scope) {
  const rec = val.nodesById.get(id) ?? null;
  const edgeTypes = new Set(scope.edgeTypes || []);
  const outgoing = [...val.edgesByKey.values()].filter((e) => e.source === id && edgeTypes.has(e.type));
  outgoing.sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1));
  return canonicalJson({ rec, outgoing });
}

function summarizeEntry(entry) {
  const { journal, ...rest } = entry;
  return { ...rest, journalPositions: journal ? journal.length : 0 };
}

function swapStore(store, work) {
  for (const k of Object.keys(work)) store[k] = work[k];
}
