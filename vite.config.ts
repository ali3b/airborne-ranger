import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5195, host: '0.0.0.0' },
  preview: { port: 5195, host: '0.0.0.0' },
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
