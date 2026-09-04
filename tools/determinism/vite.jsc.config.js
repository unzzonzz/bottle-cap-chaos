import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Bundle the determinism check into one file that `jsc` can run.
 *
 * `jsc` is a bare shell: no module resolution, no node_modules, no JSON imports.
 * So everything — the game, three's geometry code, Rapier's base64 wasm, and the
 * three log fixtures — is inlined into a single IIFE.
 *
 * ── nothing here may change the arithmetic ─────────────────────────────────
 * Minification is off and the target is the same `es2020` the game ships with.
 * A bundler that rewrote a float literal, or lowered an operation into a helper
 * that rounds differently, would be a difference between the two engines that
 * came from the BUILD rather than from the engine — which is the one confound
 * this measurement cannot tolerate. Same source, same target, no transforms.
 */
export default defineConfig({
  root: HERE,
  logLevel: 'warn',
  build: {
    target: 'es2020',
    minify: false,
    outDir: resolve(HERE, 'build'),
    emptyOutDir: true,
    lib: {
      entry: resolve(HERE, 'jsc-entry.js'),
      formats: ['iife'],
      name: 'MsaDeterminism',
      fileName: () => 'jsc-bundle.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
