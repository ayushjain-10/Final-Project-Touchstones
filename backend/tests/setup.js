/**
 * Jest Test Setup
 * Configures test environment and global utilities
 */

// Load polyfill first (for Node 25+ SlowBuffer compatibility)
require('../src/polyfill');

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.USE_SUPABASE = 'true';
process.env.USE_MOCK_DB = 'true';
process.env.JWT_SECRET = 'test-secret-key';
// Deferred surfaces are gated OFF in production (return 503), but their route
// handlers still exist and are covered by the integration suites. Enable them in
// tests so those suites exercise the real handlers rather than the 503 stub.
process.env.ENABLE_AUTOPILOT = 'true';
process.env.ENABLE_SOURCING = 'true';

// Increase test timeout for integration tests
jest.setTimeout(30000);

// Global test utilities
const jwt = require('jsonwebtoken');

global.testUtils = {
  generateTestToken: (userId = 'test-user-id', email = 'test@example.com') => {
    return jwt.sign(
      { id: userId, email },
      process.env.JWT_SECRET || 'test-secret-key',
      { expiresIn: '1h' }
    );
  },

  randomEmail: () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,

  randomString: (length = 10) => Math.random().toString(36).substring(2, 2 + length),

  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Suppress noisy logs during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
};

// Clean mock data file before tests to ensure test isolation
const fs = require('fs');
const path = require('path');
const mockDataFile = path.join(__dirname, '..', 'mock-data.json');
if (fs.existsSync(mockDataFile)) {
  fs.unlinkSync(mockDataFile);
}

// Cleanup after all tests
afterAll(async () => {
  // Remove mock data file created during tests
  if (fs.existsSync(mockDataFile)) {
    fs.unlinkSync(mockDataFile);
  }
  await new Promise(resolve => setTimeout(resolve, 500));
});
