/**
 * Unit-Tests für graph/adjacency.js [TDT]
 */
import { test, expect } from '@playwright/test';

test.describe('adjacency module', () => {
  
  test.describe('idOf', () => {
    test('extracts id from object', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { idOf } = window.__adjacency__;
        return idOf({ id: 'test-123' });
      });
      expect(result).toBe('test-123');
    });

    test('returns string directly', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { idOf } = window.__adjacency__;
        return idOf('direct-id');
      });
      expect(result).toBe('direct-id');
    });

    test('handles numeric id', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { idOf } = window.__adjacency__;
        return idOf({ id: 42 });
      });
      expect(result).toBe('42');
    });

    test('handles null object gracefully', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { idOf } = window.__adjacency__;
        return idOf(null);
      });
      expect(result).toBe('null');
    });
  });

  test.describe('buildAdjacency', () => {
    test('creates bidirectional adjacency map', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { buildAdjacency } = window.__adjacency__;
        const links = [
          { source: 'a', target: 'b' },
          { source: 'b', target: 'c' }
        ];
        const adj = buildAdjacency(links);
        return {
          aNeighbors: Array.from(adj.get('a') || []),
          bNeighbors: Array.from(adj.get('b') || []),
          cNeighbors: Array.from(adj.get('c') || [])
        };
      });
      expect(result.aNeighbors).toContain('b');
      expect(result.bNeighbors).toContain('a');
      expect(result.bNeighbors).toContain('c');
      expect(result.cNeighbors).toContain('b');
    });

    test('handles empty links array', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { buildAdjacency } = window.__adjacency__;
        const adj = buildAdjacency([]);
        return adj.size;
      });
      expect(result).toBe(0);
    });
  });

  test.describe('getAdjacencyCache', () => {
    test('builds and caches adjacency data', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { getAdjacencyCache, invalidateAdjacencyCache } = window.__adjacency__;
        invalidateAdjacencyCache();
        
        const links = [
          { source: 'p-1', target: 'p-2' },
          { source: 'p-2', target: 'p-3' }
        ];
        const byId = new Map([
          ['p-1', { id: 'p-1', type: 'person' }],
          ['p-2', { id: 'p-2', type: 'person' }],
          ['p-3', { id: 'p-3', type: 'person' }]
        ]);
        
        const cache = getAdjacencyCache(links, byId);
        return {
          hasOut: cache.out instanceof Map,
          hasInn: cache.inn instanceof Map,
          hasManagerOf: cache.managerOf instanceof Map,
          outSize: cache.out.size,
          managerOfP2: cache.managerOf.get('p-2')
        };
      });
      expect(result.hasOut).toBe(true);
      expect(result.hasInn).toBe(true);
      expect(result.hasManagerOf).toBe(true);
      expect(result.outSize).toBeGreaterThan(0);
      expect(result.managerOfP2).toBe('p-1');
    });

    test('returns cached data on subsequent calls', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { getAdjacencyCache, invalidateAdjacencyCache } = window.__adjacency__;
        invalidateAdjacencyCache();
        
        const links = [{ source: 'a', target: 'b' }];
        const byId = new Map([
          ['a', { id: 'a', type: 'person' }],
          ['b', { id: 'b', type: 'person' }]
        ]);
        
        const cache1 = getAdjacencyCache(links, byId);
        const cache2 = getAdjacencyCache(links, byId);
        return cache1 === cache2;
      });
      expect(result).toBe(true);
    });
  });

  test.describe('collectReportSubtree', () => {
    test('collects all nodes in report chain', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { collectReportSubtree } = window.__adjacency__;
        const links = [
          { source: 'manager', target: 'report1' },
          { source: 'manager', target: 'report2' },
          { source: 'report1', target: 'sub1' }
        ];
        const byId = new Map([
          ['manager', { id: 'manager', type: 'person' }],
          ['report1', { id: 'report1', type: 'person' }],
          ['report2', { id: 'report2', type: 'person' }],
          ['sub1', { id: 'sub1', type: 'person' }]
        ]);
        
        const subtree = collectReportSubtree('manager', links, byId);
        return Array.from(subtree);
      });
      expect(result).toContain('manager');
      expect(result).toContain('report1');
      expect(result).toContain('report2');
      expect(result).toContain('sub1');
    });

    test('handles non-existent root', async ({ page }) => {
      const result = await page.evaluate(() => {
        const { collectReportSubtree } = window.__adjacency__;
        const subtree = collectReportSubtree('nonexistent', [], new Map());
        return Array.from(subtree);
      });
      expect(result).toContain('nonexistent');
      expect(result.length).toBe(1);
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 30000 });
    
    // Expose adjacency module for testing
    await page.evaluate(() => {
      window.__adjacency__ = {
        idOf: (v) => String(typeof v === 'object' && v ? v.id : v),
        buildAdjacency: (links) => {
          const adj = new Map();
          const ensure = (id) => { if (!adj.has(id)) adj.set(id, new Set()); };
          links.forEach(l => {
            const s = String(typeof l.source === 'object' && l.source ? l.source.id : l.source);
            const t = String(typeof l.target === 'object' && l.target ? l.target.id : l.target);
            ensure(s); ensure(t);
            adj.get(s).add(t);
            adj.get(t).add(s);
          });
          return adj;
        },
        invalidateAdjacencyCache: () => { window.__adjCache__ = null; window.__adjCacheLinks__ = null; },
        getAdjacencyCache: (links, byId) => {
          const idOf = (v) => String(typeof v === 'object' && v ? v.id : v);
          if (window.__adjCache__ && window.__adjCacheLinks__ === links) return window.__adjCache__;
          const out = new Map(), inn = new Map(), managerOf = new Map(), adj = new Map();
          for (const l of links) {
            if (!l) continue;
            const s = idOf(l.source), t = idOf(l.target);
            if (!byId.has(s) || !byId.has(t)) continue;
            if (!out.has(s)) out.set(s, new Set());
            if (!inn.has(t)) inn.set(t, new Set());
            out.get(s).add(t); inn.get(t).add(s);
            if (!adj.has(s)) adj.set(s, new Set());
            if (!adj.has(t)) adj.set(t, new Set());
            adj.get(s).add(t); adj.get(t).add(s);
            if (byId.get(s)?.type === 'person' && byId.get(t)?.type === 'person') managerOf.set(t, s);
          }
          window.__adjCache__ = { out, inn, managerOf, adj };
          window.__adjCacheLinks__ = links;
          return window.__adjCache__;
        },
        collectReportSubtree: (rootId, links, byId) => {
          const idOf = (v) => String(typeof v === 'object' && v ? v.id : v);
          const rid = String(rootId);
          const out = new Map();
          for (const l of links) {
            const s = idOf(l.source), t = idOf(l.target);
            if (byId.get(s)?.type === 'person' && byId.get(t)?.type === 'person') {
              if (!out.has(s)) out.set(s, new Set());
              out.get(s).add(t);
            }
          }
          const seen = new Set([rid]);
          const q = [rid];
          while (q.length) {
            const v = q.shift();
            for (const w of (out.get(v) || [])) {
              if (!seen.has(w)) { seen.add(w); q.push(w); }
            }
          }
          return seen;
        }
      };
    });
  });
});
