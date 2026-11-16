import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // strictPort: a second dev server must fail loudly rather than move to another port —
  // two Vite instances share node_modules/.vite and corrupt each other's dependency cache.
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts', 'shared/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
