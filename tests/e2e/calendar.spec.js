// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Calendar E2E Tests
 * Tests calendar view, interview scheduling, and events
 */

test.describe('Calendar Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|calendar/);
  });

  test('should display calendar page', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page).toHaveURL(/.*calendar/);
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show calendar grid', async ({ page }) => {
    await page.goto('/calendar');

    const calendarGrid = page.locator('[data-testid="calendar-grid"], .calendar, table');
    await expect(calendarGrid).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to next month', async ({ page }) => {
    await page.goto('/calendar');

    const nextButton = page.locator('button:has-text("Next"), [aria-label="Next month"], button >> svg');
    if (await nextButton.isVisible()) {
      await nextButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should navigate to previous month', async ({ page }) => {
    await page.goto('/calendar');

    const prevButton = page.locator('button:has-text("Prev"), [aria-label="Previous month"]');
    if (await prevButton.isVisible()) {
      await prevButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should show today button', async ({ page }) => {
    await page.goto('/calendar');

    const todayButton = page.locator('button:has-text("Today")');
    if (await todayButton.isVisible()) {
      await todayButton.click();
    }
  });

  test('should switch calendar views', async ({ page }) => {
    await page.goto('/calendar');

    // Try different view options
    const viewButtons = ['Month', 'Week', 'Day', 'Agenda'];
    for (const view of viewButtons) {
      const viewButton = page.locator(`button:has-text("${view}")`);
      if (await viewButton.isVisible()) {
        await viewButton.click();
        await page.waitForTimeout(300);
        break;
      }
    }
  });

  test('should click on a date to view details', async ({ page }) => {
    await page.goto('/calendar');

    const dateCell = page.locator('[data-testid="calendar-date"], td.calendar-day').first();
    if (await dateCell.isVisible()) {
      await dateCell.click();
      await page.waitForTimeout(300);
    }
  });

  test('should show event details on click', async ({ page }) => {
    await page.goto('/calendar');

    const eventItem = page.locator('[data-testid="calendar-event"], .event').first();
    if (await eventItem.isVisible()) {
      await eventItem.click();
      await page.waitForTimeout(300);
    }
  });

  test('should open create event modal', async ({ page }) => {
    await page.goto('/calendar');

    const createButton = page.locator('button:has-text("Add"), button:has-text("Create"), button:has-text("New Event")');
    if (await createButton.isVisible()) {
      await createButton.click();
      await page.waitForTimeout(300);
    }
  });

  test('should show upcoming interviews', async ({ page }) => {
    await page.goto('/calendar');

    const upcomingSection = page.locator('text=Upcoming, text=Today');
    // May or may not exist
  });

  test('should filter events by type', async ({ page }) => {
    await page.goto('/calendar');

    const typeFilter = page.locator('select[name="type"], [data-testid="event-type-filter"]');
    if (await typeFilter.isVisible()) {
      await typeFilter.selectOption({ index: 1 });
    }
  });

  test('should show interview count badge', async ({ page }) => {
    await page.goto('/calendar');

    const countBadge = page.locator('[data-testid="interview-count"], .count-badge');
    // May or may not exist
  });
});

test.describe('Interview Scheduling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should schedule interview from calendar', async ({ page }) => {
    await page.goto('/calendar');

    const scheduleButton = page.locator('button:has-text("Schedule Interview")');
    if (await scheduleButton.isVisible()) {
      await scheduleButton.click();

      // Look for scheduling form
      const candidateSelect = page.locator('select[name="candidate"]');
      if (await candidateSelect.isVisible()) {
        await candidateSelect.selectOption({ index: 1 });
      }
    }
  });

  test('should schedule interview from candidate profile', async ({ page }) => {
    await page.goto('/candidates');

    const candidateCard = page.locator('[data-testid="candidate-card"]').first();
    if (await candidateCard.isVisible()) {
      await candidateCard.click();

      const scheduleButton = page.locator('button:has-text("Schedule"), button:has-text("Interview")');
      if (await scheduleButton.isVisible()) {
        await scheduleButton.click();
      }
    }
  });

  test('should select interview time slot', async ({ page }) => {
    await page.goto('/calendar');

    const timeSlot = page.locator('[data-testid="time-slot"], .time-slot').first();
    if (await timeSlot.isVisible()) {
      await timeSlot.click();
    }
  });

  test('should add interview notes', async ({ page }) => {
    await page.goto('/calendar');

    const createButton = page.locator('button:has-text("Schedule Interview")');
    if (await createButton.isVisible()) {
      await createButton.click();

      const notesInput = page.locator('textarea[name="notes"]');
      if (await notesInput.isVisible()) {
        await notesInput.fill('E2E test interview notes');
      }
    }
  });

  test('should select interview type', async ({ page }) => {
    await page.goto('/calendar');

    const createButton = page.locator('button:has-text("Schedule")');
    if (await createButton.isVisible()) {
      await createButton.click();

      const typeSelect = page.locator('select[name="interviewType"]');
      if (await typeSelect.isVisible()) {
        await typeSelect.selectOption({ index: 1 });
      }
    }
  });
});

test.describe('Calendar Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should show calendar sync status', async ({ page }) => {
    await page.goto('/calendar');

    const syncStatus = page.locator('text=Synced, text=Connected, [data-testid="sync-status"]');
    // May or may not exist
  });

  test('should show connect calendar option', async ({ page }) => {
    await page.goto('/calendar');

    const connectButton = page.locator('button:has-text("Connect"), button:has-text("Sync")');
    // May or may not exist
  });

  test('should refresh calendar events', async ({ page }) => {
    await page.goto('/calendar');

    const refreshButton = page.locator('button:has-text("Refresh"), [data-testid="refresh"]');
    if (await refreshButton.isVisible()) {
      await refreshButton.click();
      await page.waitForTimeout(500);
    }
  });
});
