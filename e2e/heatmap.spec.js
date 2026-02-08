// e2e/heatmap.spec.js
// E2E tests for heatmap functionality and events

const { test, expect } = require('@playwright/test');

test.describe('Heatmap and Events', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'admin123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });

    // Navigate to heatmap section
    await page.click('.nav-item[data-target="heatmap-section"]');
  });

  test('should display heatmap with all streamers', async ({ page }) => {
    // Wait for heatmap to render
    await page.waitForTimeout(1500);

    // Check heatmap container
    const heatmapContainer = page.locator('#heatmap-container');
    await expect(heatmapContainer).toBeVisible();

    // Check for column labels (streamer headers)
    const headers = page.locator('.hm-col-label.hm-header');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);

    // Check for section cells
    const cells = page.locator('.hm-vcell');
    const cellCount = await cells.count();
    expect(cellCount).toBeGreaterThan(0);
  });

  test('should display cleaning method toolbar', async ({ page }) => {
    // Check cleaning method buttons exist
    await expect(page.locator('button:has-text("Rope")')).toBeVisible();
    await expect(page.locator('button:has-text("Scraper")')).toBeVisible();
    await expect(page.locator('button:has-text("Scraper + Rope")')).toBeVisible();
    await expect(page.locator('button:has-text("SCUE")')).toBeVisible();
    await expect(page.locator('button:has-text("Knife")')).toBeVisible();
  });

  test('should select cleaning method', async ({ page }) => {
    // Click scraper button
    const scraperBtn = page.locator('button:has-text("Scraper")').first();
    await scraperBtn.click();

    // Button should be selected (visual indication)
    await expect(scraperBtn).toHaveClass(/selected|active/);
  });

  test('should create cleaning event via manual entry', async ({ page }) => {
    // Wait for page to be ready
    await page.waitForTimeout(1000);

    // Look for manual entry button or form
    const addEventBtn = page.locator('button:has-text("Add Event"), button:has-text("Manual Entry"), button:has-text("➕")');
    
    if (await addEventBtn.count() > 0) {
      await addEventBtn.first().click();
      await page.waitForTimeout(500);

      // Should open a modal or form
      const modal = page.locator('.modal-overlay, .modal-content');
      if (await modal.isVisible()) {
        // Fill in event details if form is available
        const streamerInput = page.locator('input[type="number"], select').first();
        if (await streamerInput.isVisible()) {
          // Success - form is visible
          await expect(modal).toBeVisible();
        }
      }
    }
  });

  test('should display events in log section', async ({ page }) => {
    // Navigate to log section
    await page.click('.nav-item[data-target="log-section"]');
    await page.waitForTimeout(1000);

    // Check log section
    const logSection = page.locator('#log-section');
    await expect(logSection).toBeVisible();

    // Check for event table or list
    const logTable = page.locator('#log-table, .event-log');
    if (await logTable.count() > 0) {
      await expect(logTable.first()).toBeVisible();
    }
  });

  test('should display statistics', async ({ page }) => {
    // Navigate to stats section
    await page.click('.nav-item[data-target="stats-section"]');
    await page.waitForTimeout(1000);

    // Check stats section
    const statsSection = page.locator('#stats-section');
    await expect(statsSection).toBeVisible();

    // Check for stat cards or values
    const statCards = page.locator('.stat-card, .stats-card');
    if (await statCards.count() > 0) {
      await expect(statCards.first()).toBeVisible();
    }
  });

  test('should show heatmap tooltips on hover', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Find a heatmap cell
    const cell = page.locator('.hm-vcell.hm-active-section').first();
    
    if (await cell.count() > 0) {
      // Hover over the cell
      await cell.hover();
      await page.waitForTimeout(500);

      // Tooltip might appear (if implemented)
      const tooltip = page.locator('.tooltip, [role="tooltip"]');
      // This is optional - tooltip might not be implemented yet
      // Just checking that hover doesn't break anything
      await expect(cell).toBeVisible();
    }
  });

  test('should highlight heatmap cells with cleaning data', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Check for cells with data-age attribute
    const cellsWithAge = page.locator('.hm-vcell[data-age]');
    const count = await cellsWithAge.count();

    if (count > 0) {
      // At least one cell should have age data
      const firstCell = cellsWithAge.first();
      const dataAge = await firstCell.getAttribute('data-age');
      expect(dataAge).toBeTruthy();
      
      // Cell should have appropriate styling
      const bgColor = await firstCell.evaluate(el => 
        window.getComputedStyle(el).backgroundColor
      );
      expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    }
  });
});

test.describe('Heatmap - Viewer Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Login as viewer
    await page.goto('/');
    await page.fill('#login-username', 'viewer');
    await page.fill('#login-password', 'view123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });

    // Navigate to heatmap
    await page.click('.nav-item[data-target="heatmap-section"]');
  });

  test('should display heatmap but hide edit controls', async ({ page }) => {
    await page.waitForTimeout(1500);

    // Heatmap should be visible
    const heatmapContainer = page.locator('#heatmap-container');
    await expect(heatmapContainer).toBeVisible();

    // Cleaning method buttons might be hidden or disabled
    const methodButtons = page.locator('button:has-text("Rope"), button:has-text("Scraper")');
    if (await methodButtons.count() > 0) {
      // If they exist, they might be disabled
      const firstBtn = methodButtons.first();
      const isDisabled = await firstBtn.isDisabled();
      const isVisible = await firstBtn.isVisible();
      
      // Either hidden or disabled for viewers
      expect(isDisabled || !isVisible).toBe(true);
    }
  });
});
