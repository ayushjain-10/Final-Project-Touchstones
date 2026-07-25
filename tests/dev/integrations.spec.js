// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Calendar Integrations (Dev)', () => {

    test.beforeEach(async ({ page }) => {
        // Login first
        await page.goto('/login');
        await page.fill('input[name="email"]', (process.env.TEST_USER_EMAIL || 'test@example.com'));
        await page.fill('input[name="password"]', (process.env.TEST_USER_PASSWORD || 'test-password'));
        await page.click('button[type="submit"]');

        // Wait for redirect to dashboard
        await page.waitForURL(/.*dashboard/, { timeout: 10000 });
    });

    test('should load integrations page', async ({ page }) => {
        await page.goto('/integrations');

        // Check page title
        await expect(page.locator('h1')).toContainText('Integrations');

        // Check Calendly section exists
        await expect(page.locator('text=Calendly')).toBeVisible();

        // Check Google Calendar section exists
        await expect(page.locator('text=Google Calendar')).toBeVisible();
    });

    test('should show Calendly connection status', async ({ page }) => {
        await page.goto('/integrations');

        // Wait for loading to complete
        await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 10000 }).catch(() => {});

        // Check if Calendly section shows connected or not connected
        const calendlySection = page.locator('text=Calendly').locator('xpath=ancestor::div[contains(@class, "bg-white")]');

        // Either shows "Connected" badge or "Connect Calendly" button
        const isConnected = await page.locator('text=Connected').first().isVisible().catch(() => false);
        const hasConnectButton = await page.locator('button:has-text("Connect Calendly")').isVisible().catch(() => false);

        expect(isConnected || hasConnectButton).toBeTruthy();
    });

    test('should show disconnect button when Calendly is connected', async ({ page }) => {
        await page.goto('/integrations');

        // Wait for loading to complete
        await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 10000 }).catch(() => {});

        // Check if Calendly is connected
        const isConnected = await page.locator('h3:has-text("Calendly")').locator('xpath=ancestor::div[contains(@class, "p-6")]').locator('text=Connected').isVisible().catch(() => false);

        if (isConnected) {
            // Should have disconnect button
            const disconnectButton = page.locator('button:has-text("Disconnect")').first();
            await expect(disconnectButton).toBeVisible();
        } else {
            // Should have connect button
            const connectButton = page.locator('button:has-text("Connect Calendly")');
            await expect(connectButton).toBeVisible();
        }
    });

    test('should show Google Calendar connection status', async ({ page }) => {
        await page.goto('/integrations');

        // Wait for loading to complete
        await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 10000 }).catch(() => {});

        // Check if Google Calendar section shows connected or not connected
        const isConnected = await page.locator('h3:has-text("Google Calendar")').locator('xpath=ancestor::div[contains(@class, "p-6")]').locator('text=Connected').isVisible().catch(() => false);
        const hasConnectButton = await page.locator('button:has-text("Connect Google Calendar")').isVisible().catch(() => false);

        expect(isConnected || hasConnectButton).toBeTruthy();
    });

    test('should navigate to calendar page', async ({ page }) => {
        await page.goto('/calendar');

        // Check page title
        await expect(page.locator('h1')).toContainText('Interview Calendar');

        // Check for integration status cards
        await expect(page.locator('text=Calendly')).toBeVisible();
        await expect(page.locator('text=Google Calendar')).toBeVisible();
    });

    test('should show schedule interview button when Google Calendar is connected', async ({ page }) => {
        await page.goto('/calendar');

        // Wait for loading to complete
        await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 10000 }).catch(() => {});

        // Check if Google Calendar is connected by looking for Schedule Interview button
        const scheduleButton = page.locator('button:has-text("Schedule Interview")');
        const manageIntegrationsLink = page.locator('a:has-text("Manage Integrations")');

        // Either shows schedule button (connected) or manage integrations link
        const hasScheduleButton = await scheduleButton.isVisible().catch(() => false);
        const hasManageLink = await manageIntegrationsLink.isVisible().catch(() => false);

        expect(hasScheduleButton || hasManageLink).toBeTruthy();
    });

    test('API: should return integration status', async ({ page, request }) => {
        // First login to get token
        await page.goto('/login');
        await page.fill('input[name="email"]', (process.env.TEST_USER_EMAIL || 'test@example.com'));
        await page.fill('input[name="password"]', (process.env.TEST_USER_PASSWORD || 'test-password'));
        await page.click('button[type="submit"]');
        await page.waitForURL(/.*dashboard/, { timeout: 10000 });

        // Get token from localStorage
        const token = await page.evaluate(() => localStorage.getItem('token'));

        // Call API directly
        const response = await request.get('http://localhost:3001/api/integrations/status', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        expect(response.ok()).toBeTruthy();

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.integrations).toBeDefined();
        expect(data.integrations.calendly).toBeDefined();
        expect(data.integrations.googleCalendar).toBeDefined();

        console.log('Integration status:', JSON.stringify(data, null, 2));
    });

    test('API: should return Calendly auth URL', async ({ page, request }) => {
        // First login to get token
        await page.goto('/login');
        await page.fill('input[name="email"]', (process.env.TEST_USER_EMAIL || 'test@example.com'));
        await page.fill('input[name="password"]', (process.env.TEST_USER_PASSWORD || 'test-password'));
        await page.click('button[type="submit"]');
        await page.waitForURL(/.*dashboard/, { timeout: 10000 });

        // Get token from localStorage
        const token = await page.evaluate(() => localStorage.getItem('token'));

        // Call API directly
        const response = await request.get('http://localhost:3001/api/integrations/calendly/auth?returnUrl=/integrations', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        expect(response.ok()).toBeTruthy();

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.authUrl).toBeDefined();
        expect(data.authUrl).toContain('calendly.com');

        console.log('Calendly auth URL:', data.authUrl);
    });

    test('API: should return Google Calendar auth URL', async ({ page, request }) => {
        // First login to get token
        await page.goto('/login');
        await page.fill('input[name="email"]', (process.env.TEST_USER_EMAIL || 'test@example.com'));
        await page.fill('input[name="password"]', (process.env.TEST_USER_PASSWORD || 'test-password'));
        await page.click('button[type="submit"]');
        await page.waitForURL(/.*dashboard/, { timeout: 10000 });

        // Get token from localStorage
        const token = await page.evaluate(() => localStorage.getItem('token'));

        // Call API directly
        const response = await request.get('http://localhost:3001/api/integrations/google/auth?returnUrl=/integrations', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        expect(response.ok()).toBeTruthy();

        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.authUrl).toBeDefined();
        expect(data.authUrl).toContain('accounts.google.com');

        console.log('Google auth URL:', data.authUrl);
    });
});
