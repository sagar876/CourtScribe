import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

/** Emits /precache-manifest.json listing every built file, for the offline service worker (public/sw.js). */
function precacheManifest(): Plugin {
  return {
    name: 'courtscribe-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .sort()
        .map((f) => `/${f}`);
      // The file names are content-hashed, so their list identifies the build.
      let hash = 0;
      for (const ch of files.join('|')) hash = (Math.imul(31, hash) + ch.charCodeAt(0)) | 0;
      this.emitFile({ type: 'asset', fileName: 'precache-manifest.json', source: JSON.stringify({ version: (hash >>> 0).toString(36), files }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precacheManifest()],
  // strictPort: a second dev server must fail loudly rather than move to another port —
  // two Vite instances share node_modules/.vite and corrupt each other's dependency cache.
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
