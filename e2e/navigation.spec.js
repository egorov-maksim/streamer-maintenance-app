// e2e/navigation.spec.js
// E2E tests for navigation and UI sections

const { test, expect } = require('@playwright/test');

test.describe('Navigation and Layout', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin before each test
    await page.goto('/');
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'admin123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
  });

  test('should display main layout elements', async ({ page }) => {
    // Check main containers are visible
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.main-content')).toBeVisible();

    // Check user info
    await expect(page.locator('#user-display-name')).toBeVisible();
    await expect(page.locator('#user-role-badge')).toBeVisible();
    await expect(page.locator('#logout-btn')).toBeVisible();
  });

  test('should navigate between sections', async ({ page }) => {
    // By default, heatmap section should be active
    const heatmapSection = page.locator('#heatmap-section');
    const logSection = page.locator('#log-section');
    const statsSection = page.locator('#stats-section');

    // Check heatmap is visible initially
    await expect(heatmapSection).toBeVisible();

    // Navigate to log section
    await page.click('.nav-item[data-target="log-section"]');
    await expect(logSection).toBeVisible();
    await expect(heatmapSection).not.toBeVisible();

    // Navigate to stats section
    await page.click('.nav-item[data-target="stats-section"]');
    await expect(statsSection).toBeVisible();
    await expect(logSection).not.toBeVisible();

    // Navigate back to heatmap
    await page.click('.nav-item[data-target="heatmap-section"]');
    await expect(heatmapSection).toBeVisible();
    await expect(statsSection).not.toBeVisible();
  });

  test('should highlight active navigation item', async ({ page }) => {
    // Check initial active state
    const heatmapNav = page.locator('.nav-item[data-target="heatmap-section"]');
    const logNav = page.locator('.nav-item[data-target="log-section"]');

    await expect(heatmapNav).toHaveClass(/active/);

    // Click log section
    await logNav.click();
    await expect(logNav).toHaveClass(/active/);
    await expect(heatmapNav).not.toHaveClass(/active/);
  });

  test('should display project configuration section', async ({ page }) => {
    const projectSection = page.locator('#project-config-section');
    await expect(projectSection).toBeVisible();

    // Check key elements
    await expect(page.locator('#cfg-numCables')).toBeVisible();
    await expect(page.locator('#cfg-sectionsPerCable')).toBeVisible();
    await expect(page.locator('#cfg-sectionLength')).toBeVisible();
  });

  test('should collapse/expand project section', async ({ page }) => {
    const projectHeader = page.locator('#project-config-section .card-header');
    const projectContent = page.locator('#project-content');
    const collapseIcon = page.locator('#project-collapse-icon');

    // Initially should be expanded
    await expect(projectContent).toBeVisible();
    await expect(collapseIcon).toContainText('▼');

    // Collapse
    await projectHeader.click();
    await expect(projectContent).not.toBeVisible();
    await expect(collapseIcon).toContainText('▶');

    // Expand again
    await projectHeader.click();
    await expect(projectContent).toBeVisible();
    await expect(collapseIcon).toContainText('▼');
  });
});
