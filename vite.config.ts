import { defineConfig } from 'vite';
const workerOrigin = 'http://127.0.0.1:8788';
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: { proxy: { '/api': {
    target: workerOrigin,
    changeOrigin: true,
    bypass(request) {
      // Wrangler sees its own origin; translate only requests from this Vite server.
      if (request.headers.origin === `http://${request.headers.host}`) request.headers.origin = workerOrigin;
    },
  } } },
});
