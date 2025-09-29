import { config } from 'dotenv';
import { vi } from 'vitest';

// Load test environment variables
config({ path: '.env.test' });

// Mock fetch globally
global.fetch = vi.fn();

// Mock undici request
vi.mock('undici', () => ({
  request: vi.fn()
}));

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});