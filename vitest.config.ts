import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node; coverage covers the numerical core and IO code.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: { provider: 'v8', include: ['src/sim/**', 'src/io/**'], reporter: ['text', 'html'] },
  },
});
