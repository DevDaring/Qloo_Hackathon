import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const API_TARGET = process.env.LAUNCHLENS_API ?? 'http://127.0.0.1:8140';

const proxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: true,
    // SSE: never buffer or compress the event stream
    configure: (p: { on: (ev: string, cb: (...args: never[]) => void) => void }) => {
      p.on('proxyRes', ((proxyRes: { headers: Record<string, string> }, _req: unknown, res: { flushHeaders?: () => void }) => {
        if ((proxyRes.headers['content-type'] ?? '').includes('text/event-stream')) {
          proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          proxyRes.headers['x-accel-buffering'] = 'no';
          // http-proxy writes the head after this hook; flush it so EventSource opens immediately
          setImmediate(() => res.flushHeaders?.());
        }
      }) as never);
    },
  },
};

export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query', 'framer-motion'],
        },
      },
    },
  },
});
