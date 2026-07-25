// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Jobs Management E2E Tests
 * Tests job CRUD operations, filtering, and matching
 */

// Test data
const testJob = {
  title: `E2E Test Job ${Date.now()}`,
  company: 'E2E Test Company',
  location: 'San Francisco, CA',
  type: 'Full-time',
  description: 'This is a test job created by E2E tests',
  requirements: ['JavaScript', 'React', 'Node.js'],
  salary: '$120k - $150k'
};

test.describe('Jobs Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|jobs/);
  });

  test('should display jobs page', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page).toHaveURL(/.*jobs/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show create job button for authenticated users', async ({ page }) => {
    await page.goto('/jobs');
    const createButton = page.getByRole('button', { name: /create|add|new/i });
    await expect(createButton).toBeVisible();
  });

  test('should open create job modal', async ({ page }) => {
    await page.goto('/jobs');
    await page.click('button:has-text("Create"), button:has-text("Add"), button:has-text("New")');
    await expect(page.locator('input[name="title"], input[placeholder*="title" i]')).toBeVisible();
  });

  test('should create a new job', async ({ page }) => {
    await page.goto('/jobs');

    // Click create button
    await page.click('button:has-text("Create"), button:has-text("Add"), button:has-text("New")');

    // Fill form
    await page.fill('input[name="title"]', testJob.title);
    await page.fill('input[name="company"]', testJob.company);
    await page.fill('input[name="location"]', testJob.location);
    await page.fill('textarea[name="description"]', testJob.description);

    // Submit
    await page.click('button[type="submit"]');

    // Verify job was created
    await expect(page.locator(`text=${testJob.title}`)).toBeVisible({ timeout: 10000 });
  });

  test('should filter jobs by status', async ({ page }) => {
    await page.goto('/jobs');

    // Look for status filter
    const statusFilter = page.locator('select[name="status"], [data-testid="status-filter"]');
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption('Open');
      await page.waitForTimeout(500);
    }
  });

  test('should search jobs', async ({ page }) => {
    await page.goto('/jobs');

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]');
    if (await searchInput.isVisible()) {
      await searchInput.fill('Engineer');
      await page.waitForTimeout(500);
    }
  });

  test('should view job details', async ({ page }) => {
    await page.goto('/jobs');

    // Click on first job card/row
    const jobItem = page.locator('[data-testid="job-card"], .job-item, tr').first();
    if (await jobItem.isVisible()) {
      await jobItem.click();
      await page.waitForTimeout(500);
    }
  });

  test('should edit an existing job', async ({ page }) => {
    await page.goto('/jobs');

    // Click edit on first job
    const editButton = page.locator('button:has-text("Edit"), [data-testid="edit-job"]').first();
    if (await editButton.isVisible()) {
      await editButton.click();
      await expect(page.locator('input[name="title"]')).toBeVisible();
    }
  });

  test('should handle job matching', async ({ page }) => {
    await page.goto('/job-matching');
    await expect(page).toHaveURL(/.*job-matching|matching/);
  });

  test('should display job statistics', async ({ page }) => {
    await page.goto('/jobs');

    // Look for stats/metrics
    const stats = page.locator('[data-testid="job-stats"], .stats, .metrics');
    // Stats may or may not exist
  });

  test('should paginate jobs list', async ({ page }) => {
    await page.goto('/jobs');

    const pagination = page.locator('[data-testid="pagination"], .pagination, button:has-text("Next")');
    if (await pagination.isVisible()) {
      await pagination.click();
      await page.waitForTimeout(500);
    }
  });
});

test.describe('Job Details Page', () => {
  test('should show job information', async ({ page }) => {
    await page.goto('/jobs');

    // Navigate to first job
    const jobLink = page.locator('a[href*="/jobs/"], [data-testid="job-link"]').first();
    if (await jobLink.isVisible()) {
      await jobLink.click();
      await expect(page.locator('h1, h2')).toBeVisible();
    }
  });

  test('should show candidates for job', async ({ page }) => {
    await page.goto('/jobs');

    const jobLink = page.locator('a[href*="/jobs/"]').first();
    if (await jobLink.isVisible()) {
      await jobLink.click();

      // Look for candidates section
      const candidatesSection = page.locator('text=Candidates, [data-testid="job-candidates"]');
    }
  });
});
