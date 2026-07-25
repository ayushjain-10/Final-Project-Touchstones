// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Authentication Flows (Dev)', () => {

    test('should register a new user successfully', async ({ page }) => {
        const randomEmail = `test.user.${Date.now()}@example.com`;

        await page.goto('/register');

        // Fill registration form
        await page.fill('input[name="name"]', 'Test User');
        await page.fill('input[name="email"]', randomEmail);
        await page.fill('input[name="company"]', 'Test Corp');
        await page.fill('input[name="password"]', 'Password123!');
        // No confirm password field in current Register.js code

        // Submit
        await page.click('button[type="submit"]');

        // Expect to be redirected to dashboard or see success
        await expect(page).toHaveURL(/.*dashboard/);

        // Verification: specific element on dashboard
        // await expect(page.locator('text=Welcome')).toBeVisible(); // This might vary, URL is safer

        // Cleanup: Logout
        // Open user menu first
        await page.getByRole('button', { name: 'Open user menu' }).click();
        // Click Logout in dropdown
        await page.getByRole('menuitem', { name: 'Logout' }).click();
    });

    test('should show error for invalid login', async ({ page }) => {
        await page.goto('/login');

        await page.fill('input[name="email"]', 'invalid@example.com');
        await page.fill('input[name="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Expect error message
        await expect(page.locator('text=Invalid credentials')).toBeVisible();
    });
});
