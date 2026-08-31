import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Roda a API dentro do próprio servidor de desenvolvimento do Vite.
 *
 * Assim o `npm run dev` sobe um processo só, na mesma porta, e o frontend
 * chama `/api` exatamente como fará em produção — onde a Vercel entrega
 * essas rotas pela função serverless de `api/index.js`.
 *
 * O módulo do servidor é recarregado quando você edita algo em `server/`.
 */
function apiDevServer(): Plugin {
  return {
    name: 'oficina-api-dev',
    apply: 'serve',
    configureServer(server) {
      let cache: { module: unknown; app: unknown } | null = null;

      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api') && !url.startsWith('/uploads')) return next();

        void (async () => {
          try {
            const module = await server.ssrLoadModule('/server/app.ts');

            // `ssrLoadModule` devolve um objeto novo quando o código muda.
            if (!cache || cache.module !== module) {
              cache = { module, app: module.createApp() };
            }

            (cache.app as (a: unknown, b: unknown, c: unknown) => void)(req, res, next);
          } catch (error) {
            server.ssrFixStacktrace(error as Error);
            next(error);
          }
        })();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiDevServer()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          scanner: ['@zxing/browser', '@zxing/library'],
        },
      },
    },
  },
});
