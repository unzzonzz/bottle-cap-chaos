import { defineConfig } from 'vite';

export default defineConfig({
  /**
   * Where the built page thinks it lives.
   *
   * ── it CANNOT be a constant, and the two consumers disagree ──────────────
   * A plain static host — `npm run preview`, or anything serving `dist/` at a
   * domain root — needs `/`. GitHub Pages serves a project site from `/<repo>/`,
   * and a page built with `/` there asks for `/assets/...`, which is one
   * directory above everything it needs.
   *
   * So the default is the one that must not break, and the sub-path is opted
   * into by the thing that needs it. `.github/workflows/
   * pages.yml` sets it from the repository's own name, so a rename or a fork
   * carries it without editing this file.
   */
  base: process.env.BCC_BASE || '/',
  // Vite does not read PORT on its own. Honouring it lets a second dev server
  // run alongside one that already holds 5173.
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    target: 'es2020',
    // three and rapier are deliberate vendor chunks; the default 500 kB warning
    // fires on their uncompressed size and is just noise. Rapier is the larger
    // of the two because the `-compat` build carries its WebAssembly module
    // inlined as base64 — the cost of not needing a wasm loader in the config.
    chunkSizeWarningLimit: 2400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@dimforge')) return 'rapier';
        },
      },
    },
  },
});
