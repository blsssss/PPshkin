import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const backend = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  envDir: '..',
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/health': backend,
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': backend,
      '/health': backend,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    env: { TZ: 'Europe/Moscow' },
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
  },
});
