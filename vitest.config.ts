import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: process.env.SKOOL_LIVE_TEST
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, 'tests/**/*.live.test.ts'],
  },
});
