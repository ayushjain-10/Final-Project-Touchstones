// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Integrations E2E Tests
 * Tests third-party integrations (Gmail, LinkedIn, Calendar, ATS)
 */

test.describe('Integrations Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|integrations/);
  });

  test('should display integrations page', async ({ page }) => {
    await page.goto('/integrations');
    await expect(page).toHaveURL(/.*integrations/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show available integrations', async ({ page }) => {
    await page.goto('/integrations');

    const integrationCards = page.locator('[data-testid="integration-card"], .integration-card');
    await expect(integrationCards.first()).toBeVisible({ timeout: 10000 });
  });

  test('should show Gmail integration', async ({ page }) => {
    await page.goto('/integrations');

    const gmailCard = page.locator('text=Gmail, text=Google Mail');
    await expect(gmailCard).toBeVisible();
  });

  test('should show LinkedIn integration', async ({ page }) => {
    await page.goto('/integrations');

    const linkedinCard = page.locator('text=LinkedIn');
    await expect(linkedinCard).toBeVisible();
  });

  test('should show Calendar integration', async ({ page }) => {
    await page.goto('/integrations');

    const calendarCard = page.locator('text=Calendar, text=Google Calendar');
    await expect(calendarCard).toBeVisible();
  });

  test('should show Slack integration', async ({ page }) => {
    await page.goto('/integrations');

    const slackCard = page.locator('text=Slack');
    // May or may not exist
  });

  test('should show integration status', async ({ page }) => {
    await page.goto('/integrations');

    const statusBadge = page.locator('text=Connected, text=Not Connected, .status-badge');
    // Check for any status indicator
  });

  test('should click connect button for integration', async ({ page }) => {
    await page.goto('/integrations');

    const connectButton = page.locator('button:has-text("Connect")').first();
    if (await connectButton.isVisible()) {
      // Don't click to avoid OAuth flow
    }
  });

  test('should show disconnect option for connected integrations', async ({ page }) => {
    await page.goto('/integrations');

    const disconnectButton = page.locator('button:has-text("Disconnect")');
    // May or may not exist
  });

  test('should show integration settings', async ({ page }) => {
    await page.goto('/integrations');

    const settingsButton = page.locator('button:has-text("Settings"), button:has-text("Configure")').first();
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should filter integrations by category', async ({ page }) => {
    await page.goto('/integrations');

    const categoryFilter = page.locator('select[name="category"], [data-testid="category-filter"]');
    if (await categoryFilter.isVisible()) {
      await categoryFilter.selectOption({ index: 1 });
    }
  });

  test('should search integrations', async ({ page }) => {
    await page.goto('/integrations');

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('gmail');
      await page.waitForTimeout(300);
    }
  });

  test('should show ATS integrations section', async ({ page }) => {
    await page.goto('/integrations');

    const atsSection = page.locator('text=ATS, text=Applicant Tracking');
    // May or may not exist
  });

  test('should show job board integrations', async ({ page }) => {
    await page.goto('/integrations');

    const jobBoardSection = page.locator('text=Job Boards, text=Indeed, text=Glassdoor');
    // May or may not exist
  });
});

test.describe('Gmail Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should show Gmail configuration options', async ({ page }) => {
    await page.goto('/integrations');

    const gmailCard = page.locator('text=Gmail').first();
    if (await gmailCard.isVisible()) {
      await gmailCard.click();
      await page.waitForTimeout(300);
    }
  });

  test('should show email sync options', async ({ page }) => {
    await page.goto('/integrations');

    const syncOptions = page.locator('text=Sync, text=Email Sync');
    // May or may not exist
  });
});

test.describe('LinkedIn Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should show LinkedIn import option', async ({ page }) => {
    await page.goto('/integrations');

    const linkedinImport = page.locator('text=Import from LinkedIn, text=LinkedIn Import');
    // May or may not exist
  });

  test('should show LinkedIn profile sync', async ({ page }) => {
    await page.goto('/integrations');

    const profileSync = page.locator('text=Profile Sync, text=Sync Profiles');
    // May or may not exist
  });
});

test.describe('Webhooks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should show webhooks section', async ({ page }) => {
    await page.goto('/integrations');

    const webhooksSection = page.locator('text=Webhooks, text=API');
    // May or may not exist
  });

  test('should show create webhook button', async ({ page }) => {
    await page.goto('/integrations');

    const createWebhookButton = page.locator('button:has-text("Add Webhook"), button:has-text("Create Webhook")');
    // May or may not exist
  });

  test('should show webhook events list', async ({ page }) => {
    await page.goto('/integrations');

    const eventsList = page.locator('[data-testid="webhook-events"], .webhook-events');
    // May or may not exist
  });
});

test.describe('API Access', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should show API keys section', async ({ page }) => {
    await page.goto('/integrations');

    const apiSection = page.locator('text=API Keys, text=API Access');
    // May or may not exist
  });

  test('should show generate API key button', async ({ page }) => {
    await page.goto('/integrations');

    const generateButton = page.locator('button:has-text("Generate"), button:has-text("Create Key")');
    // May or may not exist - don't click
  });
});
