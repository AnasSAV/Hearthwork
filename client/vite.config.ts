import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const sharedSrc = fileURLToPath(new URL('../shared/src', import.meta.url));

/**
 * `shared/` lives outside this Vite root, so its files aren't watched by default and edits
 * there would be served stale. Watch it explicitly so changes hot-reload like client files.
 */
function watchShared(): Plugin {
  return {
    name: 'focus-town:watch-shared',
    configureServer(server) {
      server.watcher.add(sharedSrc);
    },
  };
}

export default defineConfig({
  plugins: [react(), watchShared()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000, // Phaser alone is ~1.5 MB minified
  },
});
