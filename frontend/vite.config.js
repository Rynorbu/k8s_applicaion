import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_GATEWAY_URL ?? 'http://localhost:8080', changeOrigin: true } },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: { setupFiles: ['./tests/setup.js'] },
});
