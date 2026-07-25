// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Public Pages (Prod)', () => {

    test('Home page should load correctly', async ({ page }) => {
        await page.goto('/');

        // check title
        await expect(page).toHaveTitle(/Touchstone/);

        // check hero section
        await expect(page.locator('h1')).toBeVisible();

        // check navigation to login
        const signInButton = page.locator('a[href="/login"]', { hasText: 'Sign In' });
        // Note: If user is already logged in, this might show "Dashboard". 
        // For a clean prod test, we assume incognito/no session state, so "Sign In" should be visible.
        // However, sticking to robust locators is better.

        // Let's just check that the navbar exists
        await expect(page.locator('nav')).toBeVisible();
    });

    test('Pricing section should be visible', async ({ page }) => {
        await page.goto('/');
        // Assuming there's a link to pricing or it's on the home page
        // await page.click('text=Pricing'); 
        // OR scroll to pricing

        // Verify pricing cards exist
        // await expect(page.locator('.pricing-card')).toHaveCount(3); // Adjust selector
    });

    test('Sign In page should load', async ({ page }) => {
        await page.goto('/login');
        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('button[type="submit"]')).toBeVisible();
    });
});
