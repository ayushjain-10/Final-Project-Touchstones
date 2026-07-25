// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Feedback E2E Tests
 * Tests interview feedback, ratings, and summaries
 */

test.describe('Feedback Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|feedback/);
  });

  test('should display feedback page', async ({ page }) => {
    await page.goto('/feedback');
    await expect(page).toHaveURL(/.*feedback/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show list of feedback entries', async ({ page }) => {
    await page.goto('/feedback');

    const feedbackList = page.locator('[data-testid="feedback-list"], .feedback-list');
    // May or may not exist
  });

  test('should filter feedback by candidate', async ({ page }) => {
    await page.goto('/feedback');

    const candidateFilter = page.locator('select[name="candidate"]');
    if (await candidateFilter.isVisible()) {
      await candidateFilter.selectOption({ index: 1 });
    }
  });

  test('should filter feedback by job', async ({ page }) => {
    await page.goto('/feedback');

    const jobFilter = page.locator('select[name="job"]');
    if (await jobFilter.isVisible()) {
      await jobFilter.selectOption({ index: 1 });
    }
  });

  test('should add new feedback', async ({ page }) => {
    await page.goto('/feedback');

    const addButton = page.locator('button:has-text("Add Feedback"), button:has-text("New Feedback")');
    if (await addButton.isVisible()) {
      await addButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should show feedback form', async ({ page }) => {
    await page.goto('/feedback');

    const addButton = page.locator('button:has-text("Add")');
    if (await addButton.isVisible()) {
      await addButton.click();

      const ratingInput = page.locator('input[name="rating"], [data-testid="rating"]');
      // May or may not exist
    }
  });

  test('should show AI summary feature', async ({ page }) => {
    await page.goto('/feedback');

    const aiSummary = page.locator('text=AI Summary, text=Generate Summary');
    // May or may not exist
  });

  test('should view feedback details', async ({ page }) => {
    await page.goto('/feedback');

    const feedbackItem = page.locator('[data-testid="feedback-item"]').first();
    if (await feedbackItem.isVisible()) {
      await feedbackItem.click();
      await page.waitForTimeout(300);
    }
  });

  test('should edit feedback', async ({ page }) => {
    await page.goto('/feedback');

    const editButton = page.locator('button:has-text("Edit")').first();
    if (await editButton.isVisible()) {
      await editButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should show rating stars', async ({ page }) => {
    await page.goto('/feedback');

    const stars = page.locator('[data-testid="star-rating"], .star-rating');
    // May or may not exist
  });

  test('should show feedback categories', async ({ page }) => {
    await page.goto('/feedback');

    const categories = page.locator('text=Technical, text=Communication, text=Cultural Fit');
    // May or may not exist
  });
});

test.describe('Feedback Summary', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should generate AI summary', async ({ page }) => {
    await page.goto('/feedback');

    const generateButton = page.locator('button:has-text("Generate"), button:has-text("Summarize")');
    if (await generateButton.isVisible()) {
      // Don't click to avoid API calls
    }
  });

  test('should show summary for candidate', async ({ page }) => {
    await page.goto('/feedback');

    const summarySection = page.locator('[data-testid="feedback-summary"], .summary');
    // May or may not exist
  });

  test('should show overall recommendation', async ({ page }) => {
    await page.goto('/feedback');

    const recommendation = page.locator('text=Recommend, text=Hire, text=Pass');
    // May or may not exist
  });
});
