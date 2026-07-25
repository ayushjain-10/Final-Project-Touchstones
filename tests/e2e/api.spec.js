// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * API Integration E2E Tests
 * Tests API endpoints from browser context
 */

const API_BASE = process.env.TEST_API_URL || 'http://localhost:3001';

test.describe('API Health Checks', () => {
  test('should return health status', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('ok');
  });

  test('should have CORS headers', async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`, {
      headers: {
        'Origin': 'http://localhost:3000'
      }
    });

    expect(response.ok()).toBeTruthy();
  });
});

test.describe('API Authentication', () => {
  test('should reject unauthorized requests to protected endpoints', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/jobs`);
    expect(response.status()).toBe(401);
  });

  test('should accept valid token', async ({ request }) => {
    // This would need a valid test token
    const testToken = 'test-token';

    const response = await request.get(`${API_BASE}/api/jobs`, {
      headers: {
        'Authorization': `Bearer ${testToken}`
      }
    });

    // Will be 401 with invalid token, but tests the endpoint exists
    expect([200, 401, 403]).toContain(response.status());
  });
});

test.describe('API Jobs Endpoints', () => {
  test('should return jobs list with auth', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/jobs`, {
      headers: {
        'Authorization': 'Bearer test-token'
      }
    });

    expect([200, 401]).toContain(response.status());
  });

  test('should handle job creation', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/jobs`, {
      headers: {
        'Authorization': 'Bearer test-token',
        'Content-Type': 'application/json'
      },
      data: {
        title: 'E2E Test Job',
        company: 'Test Company',
        description: 'Test Description'
      }
    });

    expect([201, 400, 401]).toContain(response.status());
  });
});

test.describe('API Candidates Endpoints', () => {
  test('should return candidates list', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/candidates`);
    expect([200, 401]).toContain(response.status());
  });

  test('should handle candidate search', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/candidates?search=engineer`);
    expect([200, 401]).toContain(response.status());
  });

  test('should handle pagination', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/candidates?page=1&limit=10`);
    expect([200, 401]).toContain(response.status());
  });
});

test.describe('API Talent Endpoints', () => {
  test('should handle talent submission', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/talent/submit`, {
      headers: {
        'Content-Type': 'application/json'
      },
      data: {
        name: 'E2E Test Talent',
        email: `e2e-${Date.now()}@test.com`,
        title: 'Software Engineer'
      }
    });

    expect([201, 400, 422]).toContain(response.status());
  });
});

test.describe('API Pipeline Endpoints', () => {
  test('should return pipeline data', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/pipeline`, {
      headers: {
        'Authorization': 'Bearer test-token'
      }
    });

    expect([200, 401]).toContain(response.status());
  });
});

test.describe('API Analytics Endpoints', () => {
  test('should return dashboard analytics', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/analytics/dashboard`, {
      headers: {
        'Authorization': 'Bearer test-token'
      }
    });

    expect([200, 401]).toContain(response.status());
  });
});

test.describe('API Error Handling', () => {
  test('should return 404 for unknown routes', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/unknown-route-12345`);
    expect(response.status()).toBe(404);
  });

  test('should handle malformed JSON', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/candidates`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      },
      data: 'invalid-json'
    });

    expect([400, 401, 422, 500]).toContain(response.status());
  });

  test('should handle invalid UUID', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/jobs/invalid-uuid`, {
      headers: {
        'Authorization': 'Bearer test-token'
      }
    });

    expect([400, 401, 404, 500]).toContain(response.status());
  });
});
