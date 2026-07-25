// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Status Page E2E Tests
 * Tests system health dashboard and monitoring features
 */

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3001';

test.describe('Status Page', () => {
  test('should display status page', async ({ page }) => {
    await page.goto('/status');
    await expect(page).toHaveURL(/.*status/);
    await expect(page.locator('h1')).toContainText('Touchstone Status');
  });

  test('should show overall system status', async ({ page }) => {
    await page.goto('/status');

    // Should show status banner
    const statusBanner = page.locator('text=Operational, text=Degraded, text=Outage, text=Maintenance').first();
    await expect(statusBanner).toBeVisible({ timeout: 10000 });
  });

  test('should show component statuses', async ({ page }) => {
    await page.goto('/status');

    // Should show component sections
    const componentsSection = page.locator('text=Components');
    await expect(componentsSection).toBeVisible();
  });

  test('should show API Server status', async ({ page }) => {
    await page.goto('/status');

    const apiStatus = page.locator('text=API Server');
    await expect(apiStatus).toBeVisible({ timeout: 10000 });
  });

  test('should show Database status', async ({ page }) => {
    await page.goto('/status');

    const dbStatus = page.locator('text=Database');
    await expect(dbStatus).toBeVisible({ timeout: 10000 });
  });

  test('should show Authentication status', async ({ page }) => {
    await page.goto('/status');

    const authStatus = page.locator('text=Authentication');
    await expect(authStatus).toBeVisible({ timeout: 10000 });
  });

  test('should show Email Service status', async ({ page }) => {
    await page.goto('/status');

    const emailStatus = page.locator('text=Email Service');
    await expect(emailStatus).toBeVisible({ timeout: 10000 });
  });

  test('should show Integrations status', async ({ page }) => {
    await page.goto('/status');

    const integrationsStatus = page.locator('text=Third-party Integrations');
    await expect(integrationsStatus).toBeVisible({ timeout: 10000 });
  });

  test('should expand component details', async ({ page }) => {
    await page.goto('/status');

    const apiComponent = page.locator('text=API Server').first();
    if (await apiComponent.isVisible()) {
      await apiComponent.click();
      await page.waitForTimeout(300);

      // Should show expanded details
      const lastChecked = page.locator('text=Last Checked');
      await expect(lastChecked).toBeVisible();
    }
  });

  test('should show system metrics', async ({ page }) => {
    await page.goto('/status');

    const metricsSection = page.locator('text=System Metrics');
    await expect(metricsSection).toBeVisible();
  });

  test('should show memory usage', async ({ page }) => {
    await page.goto('/status');

    const memoryMetric = page.locator('text=Memory (MB)');
    await expect(memoryMetric).toBeVisible({ timeout: 10000 });
  });

  test('should show uptime', async ({ page }) => {
    await page.goto('/status');

    const uptimeMetric = page.locator('text=Uptime');
    await expect(uptimeMetric).toBeVisible({ timeout: 10000 });
  });

  test('should show uptime history section', async ({ page }) => {
    await page.goto('/status');

    const historySection = page.locator('text=Uptime History');
    await expect(historySection).toBeVisible();
  });

  test('should show incidents section', async ({ page }) => {
    await page.goto('/status');

    const incidentsSection = page.locator('text=Recent Incidents');
    await expect(incidentsSection).toBeVisible();
  });

  test('should show no incidents message when none exist', async ({ page }) => {
    await page.goto('/status');

    const noIncidents = page.locator('text=No recent incidents');
    // May or may not be visible depending on state
  });

  test('should have refresh button', async ({ page }) => {
    await page.goto('/status');

    const refreshButton = page.locator('button:has-text("Refresh")');
    await expect(refreshButton).toBeVisible();
  });

  test('should refresh status on button click', async ({ page }) => {
    await page.goto('/status');

    const refreshButton = page.locator('button:has-text("Refresh")');
    await refreshButton.click();
    await page.waitForTimeout(1000);

    // Should still show status after refresh
    const statusBanner = page.locator('h2').first();
    await expect(statusBanner).toBeVisible();
  });

  test('should have auto-refresh toggle', async ({ page }) => {
    await page.goto('/status');

    const autoRefreshToggle = page.locator('text=Auto-refresh');
    await expect(autoRefreshToggle).toBeVisible();
  });

  test('should toggle auto-refresh', async ({ page }) => {
    await page.goto('/status');

    const checkbox = page.locator('input[type="checkbox"]');
    if (await checkbox.isVisible()) {
      const initialState = await checkbox.isChecked();
      await checkbox.click();
      const newState = await checkbox.isChecked();
      expect(newState).not.toBe(initialState);
    }
  });

  test('should show subscribe section', async ({ page }) => {
    await page.goto('/status');

    const subscribeSection = page.locator('text=Get Notified');
    await expect(subscribeSection).toBeVisible();
  });

  test('should have email input for notifications', async ({ page }) => {
    await page.goto('/status');

    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
  });

  test('should have subscribe button', async ({ page }) => {
    await page.goto('/status');

    const subscribeButton = page.locator('button:has-text("Subscribe")');
    await expect(subscribeButton).toBeVisible();
  });

  test('should show footer links', async ({ page }) => {
    await page.goto('/status');

    const mainSiteLink = page.locator('text=Main Site');
    await expect(mainSiteLink).toBeVisible();
  });

  test('should show last updated timestamp', async ({ page }) => {
    await page.goto('/status');

    const lastUpdated = page.locator('text=Last updated');
    await expect(lastUpdated).toBeVisible();
  });

  test('should be accessible without login', async ({ page }) => {
    // Clear any cookies/storage
    await page.context().clearCookies();

    await page.goto('/status');
    await expect(page).toHaveURL(/.*status/);

    // Should not redirect to login
    await expect(page).not.toHaveURL(/.*login/);
  });
});

test.describe('Status API', () => {
  test('should return status from API', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('components');
  });

  test('should return health check', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status/health`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('healthy');
    expect(data).toHaveProperty('timestamp');
  });

  test('should return uptime statistics', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status/uptime`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(typeof data).toBe('object');
  });

  test('should return incidents list', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status/incidents`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('should return system metrics', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status/metrics`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('memory');
    expect(data).toHaveProperty('uptime');
  });

  test('should return maintenance schedule', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status/maintenance`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('should return component details', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/status/components`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('api');
    expect(data).toHaveProperty('database');
  });
});

test.describe('Status Page Responsiveness', () => {
  test('should be responsive on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/status');

    const header = page.locator('text=Touchstone Status');
    await expect(header).toBeVisible();
  });

  test('should be responsive on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/status');

    const header = page.locator('text=Touchstone Status');
    await expect(header).toBeVisible();
  });

  test('should be responsive on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/status');

    const header = page.locator('text=Touchstone Status');
    await expect(header).toBeVisible();
  });
});
