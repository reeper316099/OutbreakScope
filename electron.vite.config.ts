import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Build config: main (ESM), sandboxed preload (single CommonJS file), renderer (Vite, module workers).
export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve('electron/main.ts') } } } },
  preload: {
    build: {
      rollupOptions: {
        input: { preload: resolve('electron/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src',
    build: { rollupOptions: { input: resolve('src/index.html') }, target: 'chrome140' },
    worker: { format: 'es' },
  },
});
