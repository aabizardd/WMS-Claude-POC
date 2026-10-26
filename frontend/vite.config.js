var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var _a, _b;
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
var env = (_b = (_a = globalThis
    .process) === null || _a === void 0 ? void 0 : _a.env) !== null && _b !== void 0 ? _b : {};
var bindHost = env.VITE_BIND_HOST;
// Set when the dev server sits behind `tailscale serve` (TLS on 443), so the
// hot-reload socket dials wss://<host>/ instead of ws://<host>:5173.
var behindTls = env.VITE_PUBLIC_HTTPS === '1';
export default defineConfig({
    plugins: [react()],
    server: __assign(__assign({ host: bindHost || 'localhost', port: 5173, 
        // Vite refuses unknown Host headers; allow any tailnet (MagicDNS) name.
        allowedHosts: ['.ts.net'] }, (behindTls ? { hmr: { protocol: 'wss', clientPort: 443 } } : {})), { proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        } }),
    test: {
        environment: 'jsdom',
        setupFiles: './src/test/setup.ts',
        globals: true,
    },
});
