import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    hmr: false,
    ws: false,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (
              /node_modules\/(react|react-dom|scheduler)\//.test(id)
            ) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/katex/')) return 'vendor-katex';
            if (
              id.includes('node_modules/recharts/') ||
              /node_modules\/(d3-[^/]+|victory-vendor)\//.test(id)
            ) {
              return 'vendor-charts';
            }
            if (id.includes('node_modules/firebase/') || id.includes('node_modules/@firebase/')) {
              return 'vendor-firebase';
            }
            if (id.includes('node_modules/lucide-react/')) return 'vendor-lucide';
          }
          return undefined;
        },
      },
    },
  },
});
