import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node; coverage covers the numerical core and IO code.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000, // statistical tests run thousands of simulations; coverage instrumentation slows them further
    coverage: { provider: 'v8', include: ['src/sim/**', 'src/io/**'], reporter: ['text', 'html'] },
  },
});
