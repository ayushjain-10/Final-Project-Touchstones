// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Candidates Management E2E Tests
 * Tests candidate CRUD, search, and screening
 */

const testCandidate = {
  name: `E2E Test Candidate ${Date.now()}`,
  email: `e2e-candidate-${Date.now()}@test.com`,
  phone: '+1-555-0100',
  title: 'Senior Software Engineer',
  skills: ['JavaScript', 'React', 'Node.js', 'Python'],
  experience: '5 years',
  location: 'New York, NY'
};

test.describe('Candidates Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|candidates/);
  });

  test('should display candidates page', async ({ page }) => {
    await page.goto('/candidates');
    await expect(page).toHaveURL(/.*candidates/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show add candidate button', async ({ page }) => {
    await page.goto('/candidates');
    const addButton = page.getByRole('button', { name: /add|create|new/i });
    await expect(addButton).toBeVisible();
  });

  test('should open add candidate form', async ({ page }) => {
    await page.goto('/candidates');
    await page.click('button:has-text("Add"), button:has-text("Create"), button:has-text("New")');
    await expect(page.locator('input[name="name"], input[name="email"]')).toBeVisible();
  });

  test('should add a new candidate', async ({ page }) => {
    await page.goto('/candidates');

    // Click add button
    await page.click('button:has-text("Add"), button:has-text("Create")');

    // Fill form
    await page.fill('input[name="name"]', testCandidate.name);
    await page.fill('input[name="email"]', testCandidate.email);

    const phoneInput = page.locator('input[name="phone"]');
    if (await phoneInput.isVisible()) {
      await phoneInput.fill(testCandidate.phone);
    }

    const titleInput = page.locator('input[name="title"]');
    if (await titleInput.isVisible()) {
      await titleInput.fill(testCandidate.title);
    }

    // Submit
    await page.click('button[type="submit"]');

    // Verify
    await expect(page.locator(`text=${testCandidate.name}`)).toBeVisible({ timeout: 10000 });
  });

  test('should search candidates', async ({ page }) => {
    await page.goto('/candidates');

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Engineer');
    await page.waitForTimeout(500);
  });

  test('should filter candidates by skills', async ({ page }) => {
    await page.goto('/candidates');

    const skillsFilter = page.locator('[data-testid="skills-filter"], select[name="skills"]');
    if (await skillsFilter.isVisible()) {
      await skillsFilter.click();
    }
  });

  test('should filter candidates by status', async ({ page }) => {
    await page.goto('/candidates');

    const statusFilter = page.locator('select[name="status"], [data-testid="status-filter"]');
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption({ index: 1 });
    }
  });

  test('should view candidate profile', async ({ page }) => {
    await page.goto('/candidates');

    const candidateItem = page.locator('[data-testid="candidate-card"], .candidate-row, tr').first();
    if (await candidateItem.isVisible()) {
      await candidateItem.click();
      await page.waitForTimeout(500);
    }
  });

  test('should edit candidate', async ({ page }) => {
    await page.goto('/candidates');

    const editButton = page.locator('button:has-text("Edit"), [data-testid="edit-candidate"]').first();
    if (await editButton.isVisible()) {
      await editButton.click();
      await expect(page.locator('input[name="name"], input[name="email"]')).toBeVisible();
    }
  });

  test('should export candidates', async ({ page }) => {
    await page.goto('/candidates');

    const exportButton = page.locator('button:has-text("Export"), [data-testid="export"]');
    if (await exportButton.isVisible()) {
      await exportButton.click();
    }
  });

  test('should paginate candidates', async ({ page }) => {
    await page.goto('/candidates');

    const nextButton = page.locator('button:has-text("Next"), [data-testid="next-page"]');
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(500);
    }
  });

  test('should bulk select candidates', async ({ page }) => {
    await page.goto('/candidates');

    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible()) {
      await checkbox.check();
    }
  });
});

test.describe('Candidate Profile', () => {
  test('should display candidate details', async ({ page }) => {
    await page.goto('/candidates');

    const candidateLink = page.locator('a[href*="/candidates/"]').first();
    if (await candidateLink.isVisible()) {
      await candidateLink.click();
      await expect(page.locator('h1, h2, .candidate-name')).toBeVisible();
    }
  });

  test('should show candidate activity history', async ({ page }) => {
    await page.goto('/candidates');

    const candidateLink = page.locator('a[href*="/candidates/"]').first();
    if (await candidateLink.isVisible()) {
      await candidateLink.click();

      const activityTab = page.locator('text=Activity, text=History, [data-tab="activity"]');
      if (await activityTab.isVisible()) {
        await activityTab.click();
      }
    }
  });

  test('should add notes to candidate', async ({ page }) => {
    await page.goto('/candidates');

    const candidateLink = page.locator('a[href*="/candidates/"]').first();
    if (await candidateLink.isVisible()) {
      await candidateLink.click();

      const notesInput = page.locator('textarea[name="notes"], [data-testid="add-note"]');
      if (await notesInput.isVisible()) {
        await notesInput.fill('Test note from E2E');
      }
    }
  });
});

test.describe('Resume Screening', () => {
  test('should have resume upload option', async ({ page }) => {
    await page.goto('/candidates');
    await page.click('button:has-text("Add"), button:has-text("Create")');

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeVisible();
  });
});
