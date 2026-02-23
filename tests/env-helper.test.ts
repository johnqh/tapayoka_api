import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to reset the module cache between tests since env-helper caches .env.local
let getEnv: typeof import('../src/lib/env-helper').getEnv;
let getRequiredEnv: typeof import('../src/lib/env-helper').getRequiredEnv;

describe('env-helper', () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../src/lib/env-helper');
    getEnv = mod.getEnv;
    getRequiredEnv = mod.getRequiredEnv;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getEnv', () => {
    it('reads from process.env', () => {
      process.env.TEST_VAR_UNIQUE = 'from_env';
      expect(getEnv('TEST_VAR_UNIQUE')).toBe('from_env');
      delete process.env.TEST_VAR_UNIQUE;
    });

    it('returns default when not set', () => {
      expect(getEnv('NONEXISTENT_VAR_12345', 'default_val')).toBe('default_val');
    });

    it('returns undefined when not set and no default', () => {
      expect(getEnv('NONEXISTENT_VAR_12345')).toBeUndefined();
    });
  });

  describe('getRequiredEnv', () => {
    it('returns value when set', () => {
      process.env.REQUIRED_TEST_VAR = 'exists';
      expect(getRequiredEnv('REQUIRED_TEST_VAR')).toBe('exists');
      delete process.env.REQUIRED_TEST_VAR;
    });

    it('throws when not set', () => {
      expect(() => getRequiredEnv('NONEXISTENT_REQUIRED_VAR')).toThrow(
        'Required environment variable NONEXISTENT_REQUIRED_VAR is not set'
      );
    });
  });
});
