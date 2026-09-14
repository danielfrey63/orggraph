// Repro of the live-test finding (2026-09-14): when the depth grows, the
// new reports must spawn on the circle around their manager (radial
// build-up), not in the viewport centre. Records the FIRST rendered
// position of every node that enters the scene on a depth change and
// compares it with its manager's position at that moment.
import { test, expect } from './base.mjs';

const NODE_CIRCLES = 'g.nodes circle:not(.attribute-circle)';

async function armSpawnRecorder(page) {
  await page.evaluate(() => {
    window.__spawn = {};
    const layer = document.querySelector('svg g.nodes');
    const known = new Set([...layer.querySelectorAll('g.node')].map((g) => g.__data__ && String(g.__data__.id)));
    const posOf = (id) => {
      const n = typeof simAllById !== 'undefined' ? simAllById.get(String(id)) : null;
      return n && Number.isFinite(n.x) ? { x: n.x, y: n.y } : null;
    };
    const managerOf = (id) => {
      const l = (currentSubgraph.links || []).find((l) => String(l.source.id ?? l.source) === String(id));
      return l ? String(l.target.id ?? l.target) : null;
    };
    const record = () => {
      for (const g of layer.querySelectorAll('g.node')) {
        const id = g.__data__ && String(g.__data__.id);
        if (!id || known.has(id) || window.__spawn[id]) continue;
        const pos = posOf(id);
        if (!pos) continue;
        const mgr = managerOf(id);
        window.__spawn[id] = { pos, manager: mgr, managerPos: mgr ? posOf(mgr) : null, centre: { x: WIDTH / 2, y: HEIGHT / 2 } };
      }
    };
    window.__spawnTimer = setInterval(record, 10);
  });
}

async function readSpawns(page) {
  return page.evaluate(() => {
    clearInterval(window.__spawnTimer);
    const out = {};
    for (const [id, s] of Object.entries(window.__spawn)) {
      const d = (a, b) => (a && b) ? Math.hypot(a.x - b.x, a.y - b.y) : null;
      out[id] = { manager: s.manager, toManager: d(s.pos, s.managerPos), toCentre: d(s.pos, s.centre) };
    }
    return out;
  });
}

test('repro: deepen 1 -> 3, new nodes spawn around their manager, not in the centre', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
  await page.goto('/');
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5, { timeout: 30_000 });
  await page.locator('#depthControl .depth-down').click();
  await page.locator('#depthControl .depth-down').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(3);
  await page.waitForTimeout(1500); // let the simulation settle

  await armSpawnRecorder(page);
  await page.locator('#depthControl .depth-up').click();
  await page.locator('#depthControl .depth-up').click();
  await expect(page.locator(NODE_CIRCLES)).toHaveCount(5);
  await page.waitForTimeout(300);
  const spawns = await readSpawns(page);
  console.log('SPAWNS', JSON.stringify(spawns, null, 1));
  const radius = await page.evaluate(() => cssNumber('--node-radius') + cssNumber('--radial-child-padding') + 40);
  for (const [id, s] of Object.entries(spawns)) {
    expect(s.manager, `${id} has a manager in the scene`).toBeTruthy();
    expect(s.toManager, `${id} spawns on its manager's circle`).toBeLessThan(radius);
  }
});
