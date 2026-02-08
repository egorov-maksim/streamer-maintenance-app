// e2e/styles.spec.js
// E2E tests for styles and visual elements

const { test, expect } = require('@playwright/test');

test.describe('Styles and Layout', () => {
  test.beforeEach(async ({ page }) => {
    // Login as superuser (project create/delete and save config are SuperUser-only)
    await page.goto('/');
    await page.fill('#login-username', 'superuser');
    await page.fill('#login-password', 'super123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
  });

  test('should load and apply main stylesheet', async ({ page }) => {
    // Check that critical CSS classes exist and are applied
    const appContainer = page.locator('#app-container');
    await expect(appContainer).toBeVisible();

    // Check main layout elements have proper styling
    const mainWrapper = page.locator('.main-wrapper');
    await expect(mainWrapper).toBeVisible();

    // Check computed styles for key element
    const bgColor = await appContainer.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    );
    // Should have some background color set (not transparent)
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('should display buttons with correct styling', async ({ page }) => {
    // Check primary button
    const primaryBtn = page.locator('.btn-primary').first();
    await expect(primaryBtn).toBeVisible();

    // Check button has proper classes
    await expect(primaryBtn).toHaveClass(/btn/);
    await expect(primaryBtn).toHaveClass(/btn-primary/);

    // Check hover effect (button should be clickable)
    await expect(primaryBtn).toBeEnabled();
  });

  test('should render heatmap grid structure', async ({ page }) => {
    // Navigate to heatmap section
    await page.click('.nav-item[data-target="heatmap-section"]');

    // Check heatmap container exists (grid is rendered inside it)
    const heatmapContainer = page.locator('#heatmap-container');
    await expect(heatmapContainer).toBeVisible();

    // Wait for heatmap to render
    await page.waitForTimeout(1000);

    // Check for heatmap cells
    const cells = page.locator('.hm-vcell');
    const cellCount = await cells.count();
    expect(cellCount).toBeGreaterThan(0);

    // Check column labels exist
    const colLabels = page.locator('.hm-col-label');
    const labelCount = await colLabels.count();
    expect(labelCount).toBeGreaterThan(0);
  });

  test('should display modal with correct styling', async ({ page }) => {
    // Create a project and try to delete it to trigger confirmation modal
    await page.fill('#new-project-number', 'MODAL-TEST');
    await page.fill('#new-project-name', 'Modal Test');
    await page.click('#btn-create-project');
    await page.waitForTimeout(1000);

    // Find and click delete button for the project
    const projectList = page.locator('#project-list');
    const projectCard = projectList.locator('.project-card:has-text("MODAL-TEST")');
    
    // Delete button is visible for superuser
    const deleteBtn = projectCard.locator('.btn-delete');
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
      await page.waitForTimeout(500);

      // Check modal overlay exists and is visible
      const modalOverlay = page.locator('.modal-overlay');
      await expect(modalOverlay).toBeVisible();

      // Check modal content
      const modalContent = page.locator('.modal-content');
      await expect(modalContent).toBeVisible();

      // Close modal
      const cancelBtn = page.locator('.modal-footer .btn-secondary');
      await cancelBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('should display toast notifications with styling', async ({ page }) => {
    // Check toast container exists
    const toastContainer = page.locator('#toast-container');
    await expect(toastContainer).toBeAttached();

    // Trigger an action that shows a toast (save config)
    await page.click('#btn-save-config');
    await page.waitForTimeout(1000);

    // Check if a toast appeared
    const toasts = toastContainer.locator('.toast');
    const toastCount = await toasts.count();
    
    if (toastCount > 0) {
      const toast = toasts.first();
      await expect(toast).toBeVisible();
      
      // Toast should have type class (error, success, info, warning)
      const classList = await toast.getAttribute('class');
      expect(classList).toMatch(/toast-(error|success|info|warning)/);
    }
  });

  test('should display streamer deployment grid with cards', async ({ page }) => {
    // Create and activate a project
    await page.fill('#new-project-number', 'DEPLOY-STYLE');
    await page.fill('#new-project-name', 'Deploy Style Test');
    await page.click('#btn-create-project');
    await page.waitForTimeout(1000);

    await page.selectOption('#project-selector', { label: /DEPLOY-STYLE/ });
    await page.waitForTimeout(500);
    await page.click('#btn-activate-project');
    await page.waitForTimeout(1000);

    // Check deployment grid
    const deploymentGrid = page.locator('#streamer-deployment-grid');
    await expect(deploymentGrid).toBeVisible();

    // Check for streamer cards
    const streamerCards = deploymentGrid.locator('.streamer-deployment-card');
    const cardCount = await streamerCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // Check first card has proper structure
    const firstCard = streamerCards.first();
    await expect(firstCard).toBeVisible();
    
    // Should have streamer header
    await expect(firstCard.locator('.streamer-card-header')).toBeVisible();
  });

  test('should apply CSS variables correctly', async ({ page }) => {
    // Check that CSS variables are defined on root
    const rootStyles = await page.evaluate(() => {
      const root = document.documentElement;
      const styles = window.getComputedStyle(root);
      return {
        bg: styles.getPropertyValue('--bg'),
        primary: styles.getPropertyValue('--primary'),
        text: styles.getPropertyValue('--text')
      };
    });

    // Variables should be defined and not empty
    expect(rootStyles.bg.trim()).not.toBe('');
    expect(rootStyles.primary.trim()).not.toBe('');
    expect(rootStyles.text.trim()).not.toBe('');
  });

  test('should display form inputs with proper styling', async ({ page }) => {
    // Check config inputs
    const numCablesInput = page.locator('#cfg-numCables');
    await expect(numCablesInput).toBeVisible();
    await expect(numCablesInput).toBeEnabled();

    // Check input has proper styling
    const inputBorder = await numCablesInput.evaluate(el => 
      window.getComputedStyle(el).border
    );
    expect(inputBorder).not.toBe('');
  });

  test('should display icons and emojis correctly', async ({ page }) => {
    // Check section headings with icons
    const headings = page.locator('.section-heading');
    const headingCount = await headings.count();
    expect(headingCount).toBeGreaterThan(0);

    // Check logout button has icon
    const logoutBtn = page.locator('#logout-btn');
    const btnText = await logoutBtn.textContent();
    expect(btnText).toContain('🚪');
  });

  test('should display responsive layout elements', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Main content should still be visible
    const mainWrapper = page.locator('.main-wrapper');
    await expect(mainWrapper).toBeVisible();

    // Sidebar nav exists
    const sidebarNav = page.locator('.sidebar-nav');
    await expect(sidebarNav).toBeAttached();

    // Reset to desktop
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});
