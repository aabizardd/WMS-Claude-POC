/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Sharing over Tailscale
 * ----------------------
 * `npm run dev` stays local-only. `npm run dev:tailnet` (see
 * scripts/dev-tailnet.sh) binds the dev server to this machine's Tailscale
 * address instead of every interface, so the app is reachable from the tailnet
 * but not from the Wi-Fi you happen to be on.
 *
 * The backend is NOT exposed: /api is proxied from the dev server to
 * localhost:3000 on this machine, so the API never leaves it directly and no
 * CORS origin has to be opened up.
 */
// Read through globalThis so the config type-checks without pulling in
// @types/node just for two environment variables.
const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

const bindHost = env.VITE_BIND_HOST;
// Set when the dev server sits behind `tailscale serve` (TLS on 443), so the
// hot-reload socket dials wss://<host>/ instead of ws://<host>:5173.
const behindTls = env.VITE_PUBLIC_HTTPS === '1';

export default defineConfig({
  plugins: [react()],
  server: {
    host: bindHost || 'localhost',
    port: 5173,
    // Vite refuses unknown Host headers; allow any tailnet (MagicDNS) name.
    allowedHosts: ['.ts.net'],
    ...(behindTls ? { hmr: { protocol: 'wss', clientPort: 443 } } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
