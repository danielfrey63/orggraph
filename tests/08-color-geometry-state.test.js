import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getNodeFillByLevel,
  clustersAtPoint,
  getActiveAncestorChain,
  buildPersonTooltipLines,
  findAllPersonOrgs,
  orgDepth,
} from '../src/sections/08-color-geometry.js';
import { getDisplayLabel } from '../src/sections/06-pseudo-labels.js';
import { idOf } from '../src/sections/09-data-load.js';

// minimal ray-casting containment as the d3.polygonContains stand-in
const polygonContains = (poly, [x, y]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

beforeEach(() => {
  globalThis.idOf = idOf;
  globalThis.orgDepth = orgDepth;
  globalThis.getDisplayLabel = getDisplayLabel;
  globalThis.pseudonymizationEnabled = false;
  globalThis.pseudoData = null;
  globalThis.d3 = { polygonContains };
  globalThis.hierarchyLevels = new Map();
  globalThis.parentOf = new Map([['o2', 'o1'], ['o3', 'o2']]);
  globalThis.orgParent = new Map([['o2', 'o1'], ['o3', 'o2']]);
  globalThis.allowedOrgs = new Set();
  globalThis.clusterPolygons = new Map();
  globalThis.personAttributes = new Map();
  globalThis.activeAttributes = new Set();
  globalThis.byId = new Map([
    ['o1', { id: 'o1', label: 'Company', type: 'org' }],
    ['o2', { id: 'o2', label: 'Division', type: 'org' }],
    ['o3', { id: 'o3', label: 'Team', type: 'org' }],
    ['p1', { id: 'p1', label: 'Alice', type: 'person' }],
  ]);
  globalThis.raw = {
    orgs: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }],
    links: [
      { source: 'o1', target: 'o2' },
      { source: 'o2', target: 'o3' },
      { source: 'p1', target: 'o3' },
    ],
  };
});

describe('getNodeFillByLevel', () => {
  it('returns the default fill for non-person nodes and without hierarchy info', () => {
    expect(getNodeFillByLevel({ type: 'org' })).toBeNull();
    expect(getNodeFillByLevel(null)).toBeNull();
    expect(getNodeFillByLevel({ type: 'person', level: 1 })).toBeNull();
  });

  it('maps normalized level to top/mid/low colors', () => {
    globalThis.hierarchyLevels = new Map([['a', 0], ['b', 3]]);
    expect(getNodeFillByLevel({ type: 'person', level: 0 })).toBe('#e0e7ff'); // 0/3
    expect(getNodeFillByLevel({ type: 'person', level: 2 })).toBe('#818cf8'); // 0.67
    expect(getNodeFillByLevel({ type: 'person', level: 3 })).toBe('#4F46E5'); // 1.0
  });
});

describe('getActiveAncestorChain', () => {
  it('collects only allowed orgs along the parent chain including self', () => {
    globalThis.allowedOrgs = new Set(['o1', 'o3']);
    expect(Array.from(getActiveAncestorChain('o3')).sort()).toEqual(['o1', 'o3']);
  });

  it('returns an empty set when nothing on the chain is allowed', () => {
    expect(getActiveAncestorChain('o3').size).toBe(0);
  });
});

describe('clustersAtPoint', () => {
  const square = (cx, cy, r) => [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];

  it('returns labels of allowed clusters containing the point, deepest first', () => {
    globalThis.allowedOrgs = new Set(['o1', 'o3']);
    globalThis.clusterPolygons = new Map([
      ['o1', square(0, 0, 100)],
      ['o3', square(0, 0, 10)],
    ]);
    expect(clustersAtPoint([0, 0])).toEqual(['Team', 'Company']); // o3 depth 2 first
    expect(clustersAtPoint([50, 50])).toEqual(['Company']);
  });

  it('skips disallowed orgs and degenerate polygons', () => {
    globalThis.allowedOrgs = new Set(['o2']);
    globalThis.clusterPolygons = new Map([
      ['o1', square(0, 0, 100)], // not allowed
      ['o2', [[0, 0], [1, 1]]], // fewer than 3 points
    ]);
    expect(clustersAtPoint([0, 0])).toEqual([]);
  });
});

describe('findAllPersonOrgs', () => {
  it('returns the full upward org chain, base org first', () => {
    expect(findAllPersonOrgs('p1')).toEqual(['Team', 'Division', 'Company']);
  });

  it('returns empty for missing person or malformed state', () => {
    expect(findAllPersonOrgs(null)).toEqual([]);
    expect(findAllPersonOrgs('ghost')).toEqual([]);
  });
});

describe('buildPersonTooltipLines', () => {
  it('starts with the person header and lists all org memberships', () => {
    const lines = buildPersonTooltipLines('p1', 'Alice');
    expect(lines[0]).toBe('Alice'); // FR-4.2a: no emoji, registry type name when typed
    expect(lines).toContain('Zugehörigkeiten:');
    expect(lines).toContain('  • Team');
  });

  it('lists active attributes with values and flags inactive-only sets', () => {
    globalThis.personAttributes = new Map([['p1', new Map([['Coach', '1'], ['Level', 'Senior']])]]);
    globalThis.activeAttributes = new Set(['Coach', 'Level']);
    const lines = buildPersonTooltipLines('p1', 'Alice');
    expect(lines).toContain('  • Coach');
    expect(lines).toContain('  • Level: Senior');

    globalThis.activeAttributes = new Set();
    const none = buildPersonTooltipLines('p1', 'Alice');
    expect(none).not.toContain('Ringe:'); // no active badges, no empty section
  });

  it('lists cursor orgs when provided', () => {
    const lines = buildPersonTooltipLines('p1', 'Alice', ['Division']);
    expect(lines).toContain('Am Cursor:');
    expect(lines).toContain('  • Division');
  });

  describe('property diff in diff mode (FR-8.13/FR-5.8)', () => {
    afterEach(() => {
      delete globalThis.og2Active;
      delete globalThis.og2State;
      delete globalThis.currentSubgraph;
    });
    beforeEach(() => {
      globalThis.og2Active = () => true;
      globalThis.og2State = () => ({
        registry: { nodeTypes: { Person: { props: { pensum: { nonSensitive: true }, email: {} } } } },
      });
      globalThis.byId.set('p1', { id: 'p1', label: 'Alice', type: 'Person', props: { pensum: 80 } });
      globalThis.currentSubgraph = { nodes: [{
        id: 'p1', label: 'Alice Neu', type: 'Person', diffClass: 'diff-changed',
        props: { pensum: 80, email: 'new@x.ch' },
        before: { label: 'Alice', props: { pensum: 60, email: 'old@x.ch' } },
      }] };
    });

    it('shows changed values next to their predecessors', () => {
      const lines = buildPersonTooltipLines('p1', 'Alice Neu');
      expect(lines).toContain('Änderungen (Diff):');
      expect(lines).toContain('  Name: Alice → Alice Neu');
      expect(lines).toContain('  pensum: 60 → 80');
      expect(lines).toContain('  email: old@x.ch → new@x.ch');
    });

    it('stays fail-closed in pseudo mode: sensitive values and raw labels hidden (E48/E60)', () => {
      globalThis.pseudonymizationEnabled = true;
      const lines = buildPersonTooltipLines('p1', 'Person 7');
      expect(lines).toContain('  Name geändert');
      expect(lines).toContain('  pensum: 60 → 80'); // whitelisted
      expect(lines.join('\n')).not.toContain('old@x.ch');
      expect(lines.join('\n')).not.toContain('Alice');
    });

    it('adds no diff section for unchanged or non-diff nodes', () => {
      globalThis.currentSubgraph = { nodes: [{ id: 'p1', label: 'Alice', type: 'Person', props: {} }] };
      expect(buildPersonTooltipLines('p1', 'Alice')).not.toContain('Änderungen (Diff):');
    });
  });
});
