import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import fs from 'fs';

// If running inside a Windows junction / symlink, align process.cwd() with realpath
// so Vite's file-serving security check, rollup, and esbuild cache all match
const realDir = fs.realpathSync(fileURLToPath(new URL('.', import.meta.url)));
if (process.cwd() !== realDir) {
  try {
    process.chdir(realDir);
  } catch (e) {}
}

export default defineConfig({
  server: {
    port: 5173,
    fs: {
      strict: false,
      allow: [realDir, '..']
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, req, res) => {
            if (res && !res.headersSent && typeof res.writeHead === 'function') {
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ status: 'offline', message: 'FastAPI backend is offline; using static preprocessed data' }));
            }
          });
        }
      }
    }
  }
});


