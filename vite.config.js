import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  // Vite does not read PORT on its own. Honouring it lets a second dev server
  // run alongside one that already holds 5173.
  server: { port: Number(process.env.PORT) || 5173 },
  build: {
    target: 'es2020',
    // three is one deliberate vendor chunk; the default 500 kB warning fires on
    // its uncompressed size and is just noise.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
});
