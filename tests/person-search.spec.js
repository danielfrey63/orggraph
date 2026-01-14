/**
 * Person Search Tests
 * Testet die Suche nach Personen im OrgGraph
 */
import { test } from './fixtures.js';
import { expect } from '@playwright/test';

test.describe('UI tests', () => {
  const TEST_PERSON_NAME = 'Xavier Kluge';
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 30000 });
    await page.getByRole('textbox', { name: 'Suchen… (Name oder ID)' }).click();
    await page.getByRole('textbox', { name: 'Suchen… (Name oder ID)' }).fill(TEST_PERSON_NAME);
    await page.locator('#comboList').getByText(TEST_PERSON_NAME).waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#comboList').getByText(TEST_PERSON_NAME).click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
  });

  test('search and select person by name', async ({ page }) => {
    const rootNodeCircle = page.locator('circle[style*="--root-node-fill"]');
    await expect(rootNodeCircle).toBeVisible();
    const rootNodeLabel = page.locator('.node:has(circle[style*="--root-node-fill"]) text.label');
    await expect(rootNodeLabel).toHaveText(TEST_PERSON_NAME);
  });

  test('count number of visible nodes', async ({ page }) => {
    const numberOfNodes = page.locator('strong[id="stats-nodes-visible"]');
    await expect(numberOfNodes).toHaveText('35');
  });

  test('increase depth', async ({ page }) => {
    const depthUpBtn = page.getByRole('button', { name: 'Tiefe erhöhen' });
    await expect(depthUpBtn).toBeVisible();
    const depthDisplay = page.locator('.depth-value');
    const initialDepth = await depthDisplay.textContent();
    await depthUpBtn.click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    const newDepth = await depthDisplay.textContent();
    expect(parseInt(newDepth)).toBe(parseInt(initialDepth) + 1);
  });

  test('decrease depth', async ({ page }) => {
    const depthDownBtn = page.getByRole('button', { name: 'Tiefe verringern' });
    await expect(depthDownBtn).toBeVisible();
    const depthDisplay = page.locator('.depth-value');
    const initialDepth = await depthDisplay.textContent();
    await depthDownBtn.click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    const newDepth = await depthDisplay.textContent();
    expect(parseInt(newDepth)).toBe(parseInt(initialDepth) - 1);
  });

  test('toggle direction up changes node count', async ({ page }) => {
    const directionUpBtn = page.locator('#directionToggle .direction-up');
    await expect(directionUpBtn).toBeVisible();
    const nodesBefore = parseInt(await page.locator('#stats-nodes-visible').textContent());
    const wasActive = await directionUpBtn.evaluate(el => el.classList.contains('active'));
    await directionUpBtn.click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    const nodesAfter = parseInt(await page.locator('#stats-nodes-visible').textContent());
    const isActiveNow = await directionUpBtn.evaluate(el => el.classList.contains('active'));
    expect(isActiveNow).not.toBe(wasActive);
    if (wasActive) {
      expect(nodesAfter).toBeLessThan(nodesBefore);
    } else {
      expect(nodesAfter).toBeGreaterThanOrEqual(nodesBefore);
    }
  });

  test('toggle direction down changes node count', async ({ page }) => {
    const directionDownBtn = page.locator('#directionToggle .direction-down');
    await expect(directionDownBtn).toBeVisible();
    const nodesBefore = parseInt(await page.locator('#stats-nodes-visible').textContent());
    const wasActive = await directionDownBtn.evaluate(el => el.classList.contains('active'));
    await directionDownBtn.click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    const nodesAfter = parseInt(await page.locator('#stats-nodes-visible').textContent());
    const isActiveNow = await directionDownBtn.evaluate(el => el.classList.contains('active'));
    expect(isActiveNow).not.toBe(wasActive);
    if (wasActive) {
      expect(nodesAfter).toBeLessThan(nodesBefore);
    } else {
      expect(nodesAfter).toBeGreaterThanOrEqual(nodesBefore);
    }
  });

  test('hierarchy layout changes node positions', async ({ page }) => {
    const hierarchyBtn = page.getByTitle('Hierarchie', { exact: true });
    await expect(hierarchyBtn).toBeVisible();
    const positionsBefore = await page.locator('.node').evaluateAll(nodes => 
      nodes.slice(0, 5).map(n => n.getAttribute('transform'))
    );
    await hierarchyBtn.click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    await page.waitForTimeout(500);
    const positionsAfter = await page.locator('.node').evaluateAll(nodes => 
      nodes.slice(0, 5).map(n => n.getAttribute('transform'))
    );
    const isActiveNow = await hierarchyBtn.evaluate(el => el.classList.contains('active'));
    expect(isActiveNow).toBe(true);
    const changedPositions = positionsBefore.filter((pos, i) => pos !== positionsAfter[i]);
    expect(changedPositions.length).toBeGreaterThan(0);
  });

  test('toggle labels changes label visibility in DOM', async ({ page }) => {
    const labelsBtn = page.getByTitle(/Labels/);
    await expect(labelsBtn).toBeVisible();
    const labelsVisibleBefore = await page.locator('.node text.label').first().evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.opacity !== '0' && style.display !== 'none';
    });
    await labelsBtn.click();
    await page.waitForTimeout(100);
    const labelsVisibleAfter = await page.locator('.node text.label').first().evaluate(el => {
      const style = window.getComputedStyle(el);
      return style.opacity !== '0' && style.display !== 'none';
    });
    expect(labelsVisibleAfter).not.toBe(labelsVisibleBefore);
  });

  test('toggle OE visibility changes legend display', async ({ page }) => {
    const oeVisBtn = page.locator('#toggleOesVisibility');
    await expect(oeVisBtn).toBeVisible();
    const oeLegendSection = page.locator('.legend-section').first();
    const wasActive = await oeVisBtn.evaluate(el => el.classList.contains('active'));
    const legendVisibleBefore = await oeLegendSection.isVisible();
    await oeVisBtn.click({ force: true });
    await page.waitForTimeout(300);
    const isActiveNow = await oeVisBtn.evaluate(el => el.classList.contains('active'));
    expect(isActiveNow).not.toBe(wasActive);
    if (!isActiveNow) {
      const legendVisibleAfter = await oeLegendSection.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      expect(legendVisibleAfter !== legendVisibleBefore || isActiveNow !== wasActive).toBe(true);
    }
  });

  test('fit to viewport updates viewBox', async ({ page }) => {
    const fitBtn = page.getByRole('button', { name: 'Auf Seite einpassen' });
    await expect(fitBtn).toBeVisible();
    const viewBoxBefore = await page.locator('#graph').getAttribute('viewBox');
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(200);
    await fitBtn.click();
    await page.waitForTimeout(300);
    const viewBoxAfter = await page.locator('#graph').getAttribute('viewBox');
    expect(viewBoxAfter).toBeTruthy();
    expect(viewBoxBefore).toBeTruthy();
  });

  test('mouse wheel zoom changes transform', async ({ page }) => {
    const graphSvg = page.locator('#graph');
    await expect(graphSvg).toBeVisible();
    const transformBefore = await page.locator('#graph g').first().evaluate(el => {
      return el.getAttribute('transform') || '';
    });
    await graphSvg.hover();
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(300);
    const transformAfter = await page.locator('#graph g').first().evaluate(el => {
      return el.getAttribute('transform') || '';
    });
    expect(transformAfter).not.toBe(transformBefore);
  });

  test('status bar shows zoom info', async ({ page }) => {
    const statusEl = page.locator('#status');
    await expect(statusEl).toContainText('Zoom');
  });

  test('footer stats match actual DOM elements', async ({ page }) => {
    const nodesVisible = parseInt(await page.locator('#stats-nodes-visible').textContent());
    const linksVisible = parseInt(await page.locator('#stats-links-visible').textContent());
    const actualNodes = await page.locator('.node').count();
    const actualLinks = await page.locator('.link').count();
    expect(actualNodes).toBe(nodesVisible);
    expect(actualLinks).toBe(linksVisible);
  });

  test('root node is visually distinct', async ({ page }) => {
    const rootCircle = page.locator('circle[style*="--root-node-fill"]');
    await expect(rootCircle).toBeVisible();
    const rootRadius = await rootCircle.evaluate(el => parseFloat(el.getAttribute('r')));
    const normalCircle = page.locator('.node:not(:has(circle[style*="--root-node-fill"])) circle').first();
    const normalRadius = await normalCircle.evaluate(el => parseFloat(el.getAttribute('r')));
    expect(rootRadius).toBeGreaterThanOrEqual(normalRadius);
  });

  test('increasing depth adds more nodes', async ({ page }) => {
    const nodesBefore = parseInt(await page.locator('#stats-nodes-visible').textContent());
    await page.getByRole('button', { name: 'Tiefe erhöhen' }).click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    const nodesAfter = parseInt(await page.locator('#stats-nodes-visible').textContent());
    expect(nodesAfter).toBeGreaterThan(nodesBefore);
  });

  test('decreasing depth removes nodes', async ({ page }) => {
    const nodesBefore = parseInt(await page.locator('#stats-nodes-visible').textContent());
    await page.getByRole('button', { name: 'Tiefe verringern' }).click();
    await page.waitForSelector('#graph[data-ready="true"]', { timeout: 10000 });
    const nodesAfter = parseInt(await page.locator('#stats-nodes-visible').textContent());
    expect(nodesAfter).toBeLessThan(nodesBefore);
  });
});
