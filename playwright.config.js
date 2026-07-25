// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Touchstone E2E Test Configuration
 * Supports dev, prod, and API testing
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    timeout: 60000,
    expect: {
        timeout: 10000,
    },
    reporter: [
        ['html', { outputFolder: 'test-results/html-report' }],
        ['json', { outputFile: 'test-results/results.json' }],
        ['list']
    ],
    use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        actionTimeout: 15000,
        navigationTimeout: 30000,
    },
    projects: [
        {
            name: 'dev',
            testMatch: /.*dev\/.*\.spec\.js/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'http://localhost:3000',
            },
        },
        {
            name: 'prod',
            testMatch: /.*prod\/.*\.spec\.js/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: 'https://www.touchstone.tech',
            },
        },
        {
            name: 'e2e',
            testMatch: /.*e2e\/.*\.spec\.js/,
            use: {
                ...devices['Desktop Chrome'],
                baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
            },
        },
        {
            name: 'mobile',
            testMatch: /.*e2e\/.*\.spec\.js/,
            use: {
                ...devices['iPhone 13'],
                baseURL: 'http://localhost:3000',
            },
        },
    ],
});
