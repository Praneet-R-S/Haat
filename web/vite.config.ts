import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/uploads': 'http://localhost:8787',
      '/seed': 'http://localhost:8787',
      '/checkout': 'http://localhost:8787',
      '/mcp': 'http://localhost:8787',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
