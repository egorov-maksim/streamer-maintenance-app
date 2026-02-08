// e2e/auth.spec.js
// E2E tests for authentication flows

const { test, expect } = require('@playwright/test');

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display login page on initial load', async ({ page }) => {
    // Check login page is visible
    await expect(page.locator('#login-page')).toBeVisible();
    await expect(page.locator('.login-form')).toBeVisible();
    
    // Check form elements
    await expect(page.locator('#login-username')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
    await expect(page.locator('#login-submit')).toBeVisible();
  });

  test('should login successfully with superuser credentials', async ({ page }) => {
    // Fill login form
    await page.fill('#login-username', 'superuser');
    await page.fill('#login-password', 'super123');
    await page.click('#login-submit');

    // Wait for app to load
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#login-page')).not.toBeVisible();

    // Check user info is displayed
    await expect(page.locator('#user-display-name')).toContainText('superuser');
    await expect(page.locator('#user-role-badge')).toContainText('superuser');
  });

  test('should login successfully with admin credentials', async ({ page }) => {
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'admin123');
    await page.click('#login-submit');

    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#user-role-badge')).toContainText('admin');
  });

  test('should login successfully with viewer credentials', async ({ page }) => {
    await page.fill('#login-username', 'viewer');
    await page.fill('#login-password', 'view123');
    await page.click('#login-submit');

    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#user-role-badge')).toContainText('viewer');
  });

  test('should reject login with invalid credentials', async ({ page }) => {
    await page.fill('#login-username', 'invalid');
    await page.fill('#login-password', 'wrong');
    await page.click('#login-submit');

    // Should show error and stay on login page
    await expect(page.locator('#login-error')).toBeVisible();
    await expect(page.locator('#login-page')).toBeVisible();
  });

  test('should toggle password visibility', async ({ page }) => {
    const passwordInput = page.locator('#login-password');
    const toggleButton = page.locator('#password-toggle');

    // Initially password type
    await expect(passwordInput).toHaveAttribute('type', 'password');

    // Toggle to text
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'text');

    // Toggle back to password
    await toggleButton.click();
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });

  test('should logout successfully', async ({ page, context }) => {
    // Login first
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'admin123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });

    // Logout
    await page.click('#logout-btn');

    // Should return to login page
    await expect(page.locator('#login-page')).toBeVisible();
    await expect(page.locator('#app-container')).not.toBeVisible();
  });

  test('should persist session after page reload', async ({ page, context }) => {
    // Login
    await page.fill('#login-username', 'admin');
    await page.fill('#login-password', 'admin123');
    await page.click('#login-submit');
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });

    // Reload page
    await page.reload();

    // Should still be logged in
    await expect(page.locator('#app-container')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#login-page')).not.toBeVisible();
    await expect(page.locator('#user-display-name')).toContainText('admin');
  });
});
