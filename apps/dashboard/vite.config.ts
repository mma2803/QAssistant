import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dashboard SPA build. Dev proxies /api to a backend so the browser talks
 * same-origin and avoids CORS in development. The target defaults to the remote
 * VPS deployment; set VITE_API_PROXY_TARGET (shell env or
 * apps/dashboard/.env.local) to point the dev dashboard at a local backend
 * instead. loadEnv is used because vite.config runs in Node and .env files are
 * otherwise not injected into process.env for the config. The runtime API base
 * is also configurable for non-proxied deploys via VITE_API_BASE_URL.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'https://135-181-104-90.sslip.io';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
