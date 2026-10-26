#!/bin/bash
# Run the frontend dev server on this machine's Tailscale address only, for
# sharing the app with specific people on the tailnet.
#
#   ./scripts/dev-tailnet.sh
#
# The backend is not exposed: the dev server proxies /api to localhost:3000.
# Put it behind TLS with:
#   tailscale serve --bg --https=443 http://<tailscale-ip>:5173
set -e

# The CLI is on PATH on Linux; on macOS it lives inside the app bundle.
TS_CLI="$(command -v tailscale || true)"
if [ -z "$TS_CLI" ] && [ -x "/Applications/Tailscale.app/Contents/MacOS/Tailscale" ]; then
  TS_CLI="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
fi
if [ -z "$TS_CLI" ]; then
  echo "Tailscale CLI not found. Install Tailscale, or run 'npm run dev' for local-only." >&2
  exit 1
fi

TS_IP="$("$TS_CLI" ip -4 2>/dev/null | head -1)"
if [ -z "$TS_IP" ]; then
  echo "No Tailscale IPv4 address — is Tailscale connected?" >&2
  exit 1
fi

TS_NAME="$("$TS_CLI" status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("Self",{}).get("DNSName","").rstrip("."))' 2>/dev/null || true)"

echo "Binding the dev server to the tailnet address only: $TS_IP"
[ -n "$TS_NAME" ] && echo "  plain HTTP : http://$TS_NAME:5173"
[ -n "$TS_NAME" ] && echo "  behind TLS : https://$TS_NAME  (after 'tailscale serve')"
echo

cd "$(dirname "$0")/../frontend"
# Default to the "behind tailscale serve" setup, which is how this app is
# shared: hot reload then dials wss://<host>/ instead of ws://<host>:5173.
# Export VITE_PUBLIC_HTTPS=0 when reaching the dev server directly on :5173.
exec env VITE_BIND_HOST="$TS_IP" VITE_PUBLIC_HTTPS="${VITE_PUBLIC_HTTPS:-1}" \
  npm run dev -- "$@"
