import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
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
