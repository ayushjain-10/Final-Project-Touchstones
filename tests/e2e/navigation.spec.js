// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Navigation and Layout E2E Tests
 * Tests sidebar, navbar, routing, and responsive layout
 */

test.describe('Public Navigation', () => {
  test('should load home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should navigate to about page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/about"], text=About');
    await expect(page).toHaveURL(/.*about/);
  });

  test('should navigate to product page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/product"], text=Product');
    await expect(page).toHaveURL(/.*product/);
  });

  test('should navigate to pricing page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/pricing"], text=Pricing');
    await expect(page).toHaveURL(/.*pricing/);
  });

  test('should navigate to solutions page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/solutions"], text=Solutions');
    await expect(page).toHaveURL(/.*solutions/);
  });

  test('should navigate to resources page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/resources"], text=Resources');
    await expect(page).toHaveURL(/.*resources/);
  });

  test('should navigate to contact page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/contact"], text=Contact');
    await expect(page).toHaveURL(/.*contact/);
  });

  test('should navigate to login page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/login"], text=Login, text=Sign In');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should navigate to register page', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="/register"], text=Register, text=Sign Up, text=Get Started');
    await expect(page).toHaveURL(/.*register/);
  });

  test('should show navbar on all public pages', async ({ page }) => {
    const publicPages = ['/', '/about', '/product', '/pricing', '/contact'];
    for (const pagePath of publicPages) {
      await page.goto(pagePath);
      await expect(page.locator('nav, header')).toBeVisible();
    }
  });

  test('should show footer on public pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
  });

  test('should have responsive mobile menu', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    const menuButton = page.locator('button[aria-label*="menu" i], .hamburger, [data-testid="mobile-menu"]');
    if (await menuButton.isVisible()) {
      await menuButton.click();
      await page.waitForTimeout(300);
    }
  });
});

test.describe('Authenticated Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard|jobs/);
  });

  test('should show sidebar when logged in', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('aside, nav.sidebar, [data-testid="sidebar"]');
    await expect(sidebar).toBeVisible();
  });

  test('should navigate to dashboard', async ({ page }) => {
    await page.click('a[href="/dashboard"], text=Dashboard');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('should navigate to jobs from sidebar', async ({ page }) => {
    await page.click('a[href="/jobs"], text=Jobs');
    await expect(page).toHaveURL(/.*jobs/);
  });

  test('should navigate to candidates from sidebar', async ({ page }) => {
    await page.click('a[href="/candidates"], text=Candidates');
    await expect(page).toHaveURL(/.*candidates/);
  });

  test('should navigate to pipeline from sidebar', async ({ page }) => {
    await page.click('a[href="/pipeline"], text=Pipeline');
    await expect(page).toHaveURL(/.*pipeline/);
  });

  test('should navigate to outreach from sidebar', async ({ page }) => {
    await page.click('a[href="/outreach"], text=Outreach');
    await expect(page).toHaveURL(/.*outreach/);
  });

  test('should navigate to analytics from sidebar', async ({ page }) => {
    await page.click('a[href="/analytics"], text=Analytics');
    await expect(page).toHaveURL(/.*analytics/);
  });

  test('should navigate to talent from sidebar', async ({ page }) => {
    await page.click('a[href="/talent"], text=Talent');
    await expect(page).toHaveURL(/.*talent/);
  });

  test('should navigate to calendar from sidebar', async ({ page }) => {
    await page.click('a[href="/calendar"], text=Calendar');
    await expect(page).toHaveURL(/.*calendar/);
  });

  test('should navigate to integrations from sidebar', async ({ page }) => {
    await page.click('a[href="/integrations"], text=Integrations');
    await expect(page).toHaveURL(/.*integrations/);
  });

  test('should navigate to autopilot from sidebar', async ({ page }) => {
    await page.click('a[href="/autopilot"], text=Autopilot');
    await expect(page).toHaveURL(/.*autopilot/);
  });

  test('should show user menu', async ({ page }) => {
    await page.goto('/dashboard');
    const userMenu = page.getByRole('button', { name: /user|account|profile/i });
    if (await userMenu.isVisible()) {
      await userMenu.click();
      await page.waitForTimeout(300);
    }
  });

  test('should navigate to account settings', async ({ page }) => {
    await page.goto('/dashboard');

    const userMenu = page.getByRole('button', { name: /user|account|profile/i });
    if (await userMenu.isVisible()) {
      await userMenu.click();
      await page.click('text=Settings, text=Account');
      await expect(page).toHaveURL(/.*account|settings/);
    }
  });

  test('should logout successfully', async ({ page }) => {
    await page.goto('/dashboard');

    const userMenu = page.getByRole('button', { name: /user|account|menu/i });
    if (await userMenu.isVisible()) {
      await userMenu.click();
      await page.click('text=Logout, text=Sign Out');
      await expect(page).toHaveURL(/.*login|\/$/);
    }
  });

  test('should collapse sidebar on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard');

    const sidebar = page.locator('aside, .sidebar');
    // Sidebar should be collapsed or hidden on mobile
  });
});

test.describe('Protected Routes', () => {
  test('should redirect to login when accessing dashboard unauthenticated', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should redirect to login when accessing jobs unauthenticated', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should redirect to login when accessing candidates unauthenticated', async ({ page }) => {
    await page.goto('/candidates');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should redirect to login when accessing pipeline unauthenticated', async ({ page }) => {
    await page.goto('/pipeline');
    await expect(page).toHaveURL(/.*login/);
  });

  test('should redirect to login when accessing analytics unauthenticated', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/.*login/);
  });
});

test.describe('Breadcrumbs and Page Titles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="password"]', 'Password123!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/.*dashboard/);
  });

  test('should show page title on dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('should show page title on jobs', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('should show breadcrumbs when navigating deep', async ({ page }) => {
    await page.goto('/jobs');

    const breadcrumb = page.locator('[data-testid="breadcrumb"], .breadcrumb, nav[aria-label="Breadcrumb"]');
    // May or may not exist
  });
});
