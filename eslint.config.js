import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Minimal flat config: type-aware rules across the four TS projects.
export default tseslint.config(
  {
    ignores: [
      'out/',
      'dist/',
      'coverage/',
      'node_modules/',
      'playwright-report/',
      'test-results/',
      '*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.renderer.json',
          './tsconfig.worker.json',
          './tsconfig.node.json',
          './tsconfig.test.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Rule 6: all simulation randomness must come from the seeded PRNG.
    files: ['src/sim/**/*.ts', 'src/workers/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG in src/sim/rng.ts' },
      ],
    },
  },
);
