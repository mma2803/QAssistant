import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dashboard SPA build. Dev proxies /api to the local NestJS backend so the
 * browser talks same-origin and avoids CORS in development. The API base is also
 * configurable at runtime via VITE_API_BASE_URL for non-proxied deploys.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
