// e2e/projects.spec.js
// E2E tests for project management

const { test, expect } = require('@playwright/test');

test.describe('Project Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login as superuser (project create/activate/delete are SuperUser-only)
    await page.goto('/');
    await page.fill('#login-username', 'superuser');
    await page.fill('#login-password', 'super123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
  });

  test('should create a new project', async ({ page }) => {
    // Fill in project details
    await page.fill('#new-project-number', 'E2E-TEST-001');
    await page.fill('#new-project-name', 'E2E Test Project');
    await page.fill('#new-project-vessel', 'TTN');

    // Create project
    await page.click('#btn-create-project');

    // Wait for success status
    await page.waitForTimeout(1000);

    // Verify project appears in selector
    const selector = page.locator('#project-selector');
    await expect(selector.locator('option:has-text("E2E-TEST-001")')).toBeVisible();
  });

  test('should activate a project', async ({ page }) => {
    // Create a project first
    await page.fill('#new-project-number', 'E2E-ACTIVATE');
    await page.fill('#new-project-name', 'Activate Test');
    await page.click('#btn-create-project');
    await page.waitForTimeout(1000);

    // Select the project
    await page.selectOption('#project-selector', { label: /E2E-ACTIVATE/ });
    await page.waitForTimeout(500);

    // Activate it
    await page.click('#btn-activate-project');
    await page.waitForTimeout(1000);

    // Check active project banner
    const banner = page.locator('#active-project-banner');
    await expect(banner).toBeVisible();
    await expect(page.locator('#active-project-name')).toContainText('E2E-ACTIVATE');

    // Check deployment section is visible
    await expect(page.locator('#streamer-deployment-section')).toBeVisible();
  });

  test('should deactivate active project', async ({ page }) => {
    // Assuming we have an active project from previous test
    const banner = page.locator('#active-project-banner');
    
    // If there's an active project, deactivate it
    const clearBtn = page.locator('#btn-clear-project');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await page.waitForTimeout(1000);
      
      // Banner should show "No project selected"
      await expect(page.locator('#active-project-name')).toContainText('No project');
    }
  });

  test('should display project list', async ({ page }) => {
    const projectList = page.locator('#project-list');
    await expect(projectList).toBeVisible();

    // Should have at least one project from previous tests
    const projectCards = projectList.locator('.project-card');
    await expect(projectCards.first()).toBeVisible();
  });

  test('should filter deployment section by active project', async ({ page }) => {
    // Create and activate a project
    await page.fill('#new-project-number', 'E2E-DEPLOY');
    await page.fill('#new-project-name', 'Deploy Test');
    await page.click('#btn-create-project');
    await page.waitForTimeout(1000);

    await page.selectOption('#project-selector', { label: /E2E-DEPLOY/ });
    await page.waitForTimeout(500);
    await page.click('#btn-activate-project');
    await page.waitForTimeout(1000);

    // Check deployment section shows correct project
    const deploymentSection = page.locator('#streamer-deployment-section');
    await expect(deploymentSection).toBeVisible();
    await expect(page.locator('#streamer-config-project-label')).toContainText('E2E-DEPLOY');
  });
});

test.describe('Project Management - Viewer Restrictions', () => {
  test.beforeEach(async ({ page }) => {
    // Login as viewer
    await page.goto('/');
    await page.fill('#login-username', 'viewer');
    await page.fill('#login-password', 'view123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
  });

  test('should hide admin-only project creation controls', async ({ page }) => {
    // Project creation section should be hidden
    const createSection = page.locator('.project-create-section');
    await expect(createSection).not.toBeVisible();
  });

  test('should hide admin action buttons in project list', async ({ page }) => {
    const projectList = page.locator('#project-list');
    
    // Edit and delete buttons should be hidden
    const editButtons = projectList.locator('.btn-edit');
    const deleteButtons = projectList.locator('.btn-delete');
    
    if (await editButtons.count() > 0) {
      await expect(editButtons.first()).not.toBeVisible();
    }
    if (await deleteButtons.count() > 0) {
      await expect(deleteButtons.first()).not.toBeVisible();
    }
  });
});
