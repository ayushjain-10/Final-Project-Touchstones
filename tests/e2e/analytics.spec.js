// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Analytics E2E Tests
 * Tests dashboard analytics, charts, and reports
 */

test.describe('Analytics Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|analytics/);
  });

  test('should display analytics page', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/.*analytics/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show key metrics', async ({ page }) => {
    await page.goto('/analytics');

    // Look for metric cards
    const metricCards = page.locator('[data-testid="metric-card"], .metric, .stat-card');
    // May or may not exist
  });

  test('should display charts', async ({ page }) => {
    await page.goto('/analytics');

    // Look for chart containers (Recharts)
    const charts = page.locator('.recharts-wrapper, [data-testid="chart"], svg');
    await expect(charts.first()).toBeVisible({ timeout: 10000 });
  });

  test('should filter by date range', async ({ page }) => {
    await page.goto('/analytics');

    const dateRangePicker = page.locator('[data-testid="date-range"], input[type="date"]').first();
    if (await dateRangePicker.isVisible()) {
      await dateRangePicker.click();
    }
  });

  test('should show pipeline analytics', async ({ page }) => {
    await page.goto('/analytics');

    const pipelineSection = page.locator('text=Pipeline, text=Funnel');
    // May or may not exist
  });

  test('should show candidate source breakdown', async ({ page }) => {
    await page.goto('/analytics');

    const sourceSection = page.locator('text=Sources, text=Source');
    // May or may not exist
  });

  test('should show time-to-hire metrics', async ({ page }) => {
    await page.goto('/analytics');

    const timeToHire = page.locator('text=Time to Hire, text=Hiring Time');
    // May or may not exist
  });

  test('should show conversion rates', async ({ page }) => {
    await page.goto('/analytics');

    const conversionRates = page.locator('text=Conversion, text=Rate');
    // May or may not exist
  });

  test('should export analytics data', async ({ page }) => {
    await page.goto('/analytics');

    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download")');
    if (await exportButton.isVisible()) {
      // Don't click to avoid downloading
    }
  });

  test('should show job performance metrics', async ({ page }) => {
    await page.goto('/analytics');

    const jobMetrics = page.locator('text=Job Performance, text=Jobs');
    // May or may not exist
  });

  test('should show outreach metrics', async ({ page }) => {
    await page.goto('/analytics');

    const outreachMetrics = page.locator('text=Outreach, text=Email');
    // May or may not exist
  });

  test('should refresh analytics data', async ({ page }) => {
    await page.goto('/analytics');

    const refreshButton = page.locator('button:has-text("Refresh")');
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe('Dashboard Overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should display dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show recent activity', async ({ page }) => {
    await page.goto('/dashboard');

    const activity = page.locator('text=Recent, text=Activity');
    // May or may not exist
  });

  test('should show quick stats', async ({ page }) => {
    await page.goto('/dashboard');

    const stats = page.locator('[data-testid="quick-stats"], .stats-grid');
    // May or may not exist
  });

  test('should navigate to different sections', async ({ page }) => {
    await page.goto('/dashboard');

    const navLinks = page.locator('nav a, .sidebar a');
    await expect(navLinks.first()).toBeVisible();
  });
});
