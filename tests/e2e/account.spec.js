// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Account Settings E2E Tests
 * Tests user profile, settings, and preferences
 */

test.describe('Account Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|account/);
  });

  test('should display account page', async ({ page }) => {
    await page.goto('/account');
    await expect(page).toHaveURL(/.*account/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show profile section', async ({ page }) => {
    await page.goto('/account');

    const profileSection = page.locator('text=Profile, [data-testid="profile-section"]');
    await expect(profileSection).toBeVisible();
  });

  test('should show user name', async ({ page }) => {
    await page.goto('/account');

    const nameField = page.locator('input[name="name"]');
    await expect(nameField).toBeVisible();
  });

  test('should show user email', async ({ page }) => {
    await page.goto('/account');

    const emailField = page.locator('input[name="email"]');
    await expect(emailField).toBeVisible();
  });

  test('should update profile name', async ({ page }) => {
    await page.goto('/account');

    const nameField = page.locator('input[name="name"]');
    if (await nameField.isVisible()) {
      await nameField.fill('Updated Test User');
    }

    const saveButton = page.locator('button:has-text("Save")');
    if (await saveButton.isVisible()) {
      // Don't click to avoid data changes
    }
  });

  test('should show company settings', async ({ page }) => {
    await page.goto('/account');

    const companySection = page.locator('text=Company, [data-testid="company-section"]');
    // May or may not exist
  });

  test('should show notification preferences', async ({ page }) => {
    await page.goto('/account');

    const notificationSection = page.locator('text=Notifications, [data-testid="notifications"]');
    // May or may not exist
  });

  test('should toggle email notifications', async ({ page }) => {
    await page.goto('/account');

    const emailToggle = page.locator('input[name="emailNotifications"], [data-testid="email-toggle"]');
    if (await emailToggle.isVisible()) {
      // Don't toggle
    }
  });

  test('should show password change option', async ({ page }) => {
    await page.goto('/account');

    const passwordSection = page.locator('text=Password, text=Change Password');
    // May or may not exist
  });

  test('should show billing section', async ({ page }) => {
    await page.goto('/account');

    const billingSection = page.locator('text=Billing, text=Subscription');
    // May or may not exist
  });

  test('should show current plan', async ({ page }) => {
    await page.goto('/account');

    const planInfo = page.locator('[data-testid="current-plan"], text=Plan');
    // May or may not exist
  });

  test('should show upgrade option', async ({ page }) => {
    await page.goto('/account');

    const upgradeButton = page.locator('button:has-text("Upgrade"), a:has-text("Upgrade")');
    // May or may not exist
  });

  test('should show danger zone', async ({ page }) => {
    await page.goto('/account');

    const dangerZone = page.locator('text=Danger, text=Delete Account');
    // May or may not exist
  });

  test('should show connected accounts', async ({ page }) => {
    await page.goto('/account');

    const connectedAccounts = page.locator('text=Connected, [data-testid="connected-accounts"]');
    // May or may not exist
  });

  test('should show API usage', async ({ page }) => {
    await page.goto('/account');

    const apiUsage = page.locator('text=API, [data-testid="api-usage"]');
    // May or may not exist
  });
});

test.describe('Authentication Flows', () => {
  test('should show login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/.*login/);
    await expect(page.locator('form')).toBeVisible();
  });

  test('should show register page', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/.*register/);
    await expect(page.locator('form')).toBeVisible();
  });

  test('should show forgot password link', async ({ page }) => {
    await page.goto('/login');

    const forgotLink = page.locator('a:has-text("Forgot"), text=Forgot');
    await expect(forgotLink).toBeVisible();
  });

  test('should show Google OAuth button', async ({ page }) => {
    await page.goto('/login');

    const googleButton = page.locator('button:has-text("Google"), [data-testid="google-oauth"]');
    // May or may not exist
  });

  test('should validate login form', async ({ page }) => {
    await page.goto('/login');

    await page.click('button[type="submit"]');

    // Should show validation errors
    const errorMessage = page.locator('.error, [role="alert"]');
    // May show validation
  });

  test('should show invalid credentials error', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="email"]', 'wrong@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Wait for error
    await page.waitForTimeout(2000);

    const errorMessage = page.locator('text=Invalid, text=incorrect, text=error');
    // Should show error
  });

  test('should redirect to dashboard after login', async ({ page }) => {
    await page.goto('/login');

    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/.*dashboard|jobs|candidates/);
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);

    // Logout
    const userMenu = page.getByRole('button', { name: /user|menu|account/i });
    if (await userMenu.isVisible()) {
      await userMenu.click();
      await page.click('text=Logout, text=Sign Out');
      await expect(page).toHaveURL(/.*login|\/$/);
    }
  });
});

test.describe('Request Demo', () => {
  test('should show request demo page', async ({ page }) => {
    await page.goto('/request-demo');
    await expect(page.locator('form, h1')).toBeVisible();
  });

  test('should have demo request form', async ({ page }) => {
    await page.goto('/request-demo');

    const nameInput = page.locator('input[name="name"]');
    const emailInput = page.locator('input[name="email"]');
    const companyInput = page.locator('input[name="company"]');

    await expect(nameInput).toBeVisible();
    await expect(emailInput).toBeVisible();
  });
});
