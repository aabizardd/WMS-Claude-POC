# WMS — Deployment Guide

Frontend (React + Vite) · Backend (NestJS/Express) · PostgreSQL.

---

## ★ Chosen stack: Netlify + Railway + Neon

- **Frontend → Netlify** (static, config in [`netlify.toml`](netlify.toml)).
- **Backend → Railway** (persistent Node, builds from [`backend/Dockerfile`](backend/Dockerfile), config in [`backend/railway.json`](backend/railway.json), `numReplicas: 1`).
- **Database → Neon** (serverless PostgreSQL cloud, SSL). *(Alternative: Railway Postgres.)*

**Topology (split-origin, CORS):**
```
Browser ─HTTPS→ Netlify (frontend)  ──/api→  Railway (backend, 1 replica) ──SSL→ Neon (Postgres)
   VITE_API_URL = https://<backend>.up.railway.app/api        DATABASE_URL = neon …?sslmode=require
   backend FRONTEND_ORIGIN = https://<site>.netlify.app
```

### Step-by-step

**1. Database — Neon**
1. Create a project + database `wms` at neon.tech.
2. Copy the connection string (direct endpoint) → this is `DATABASE_URL` (must include `?sslmode=require`).

**2. Backend — Railway**
1. Railway → **New Project → Deploy from GitHub repo**; select this repo.
2. In the service **Settings → Root Directory = `backend`** (so `railway.json` + `Dockerfile` are used).
3. **Variables** (Settings → Variables):
   - `DATABASE_URL` = Neon string
   - `JWT_SECRET` = a 64+ char random string
   - `JWT_EXPIRES_IN` = `1d`
   - `PORT` = `3000` (Railway also injects one; the app reads `PORT`)
   - `ERP_BASE_URL`, `ERP_CLIENT_ID`, `ERP_CLIENT_SECRET`
   - `ERP_SYNC_SCHEDULER_ENABLED` = `true`, `ERP_SYNC_INTERVAL_MS` = `60000`
   - `FRONTEND_ORIGIN` = *(fill after step 3)*
4. Deploy. The Docker `CMD` runs `prisma migrate deploy` then starts the server.
5. **Generate a public domain** (Settings → Networking → Generate Domain) → note `https://<backend>.up.railway.app`.
6. Seed once — Railway shell or a one-off: `npm run prisma:seed` (creates admin + permissions).

**3. Frontend — Netlify**
1. Netlify → **Add new site → Import from Git** → select the repo. `netlify.toml` sets base `frontend`, build `npm run build`, publish `dist`, SPA redirect.
2. **Site settings → Environment variables**: `VITE_API_URL` = `https://<backend>.up.railway.app/api`.
3. Deploy → note the site URL `https://<site>.netlify.app`.

**4. Connect them**
1. Back in Railway, set `FRONTEND_ORIGIN` = `https://<site>.netlify.app` (add your custom domain too, comma-separated) → redeploy backend.
2. (Optional) Custom domains on Netlify + Railway; HTTPS is automatic on both.

**5. Verify**
- Open the Netlify URL → login `admin` / `admin123` → **change the password**.
- Check an Oracle sync, warehouse selector, and generating a document.
- Confirm no CORS errors in the browser console (means `FRONTEND_ORIGIN` matches).

> Keep the backend at **1 replica** — the Oracle sync scheduler uses in-memory `setInterval` (`railway.json` sets `numReplicas: 1`).

---

## 1. Readiness analysis

The app is production-ready with minor prep. Key facts:

| Area | Status | Note |
| --- | --- | --- |
| API prefix | ✅ | All routes under `/api` (`setGlobalPrefix`). |
| CORS | ✅ | Configurable via `FRONTEND_ORIGIN` (comma-separated). |
| Port / DB | ✅ | From `PORT` / `DATABASE_URL` env. |
| Frontend API base | ✅ | `VITE_API_URL` (build-time), defaults to `/api`. |
| Build | ✅ | BE `npm run build`→`dist`; FE `npm run build`→`dist`. |
| Migrations | ⚠️ | Use `prisma migrate deploy` in prod (not `migrate dev`). |
| Body size | ⚠️ | Backend accepts 10 MB (base64 evidence) → proxy must allow ≥12 MB (`client_max_body_size`, set in `nginx.conf`). |
| Background scheduler | ⚠️ | Oracle sync uses in-memory `setInterval` → **run a single backend instance**, or enable the scheduler (`ERP_SYNC_SCHEDULER_ENABLED`) on only one instance. Requires a long-running server (not serverless). |
| Secrets | ⚠️ | Set a strong `JWT_SECRET`; keep ERP creds as secrets. `.env` is gitignored (frontend `.gitignore` hardened). |
| Health check | ➕ optional | No `/api/health` route; platforms can check the open port. Add one later if desired (infra-only). |

Files added for deployment: `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `docker-compose.yml`, `render.yaml`, `*.env.production.example`, `.dockerignore`.

---

## 2. Recommended architecture & platforms

**Recommended (simplest, cohesive): Render** — one Blueprint (`render.yaml`) provisions all three:

```
                     ┌───────────────────────────┐
   Browser ── HTTPS ─▶ Frontend (Static / nginx) │  app.your-domain.com
                     └─────────────┬─────────────┘
                                   │  /api (VITE_API_URL or reverse proxy)
                     ┌─────────────▼─────────────┐
                     │  Backend (NestJS, 1 inst) │  api.your-domain.com
                     └─────────────┬─────────────┘
                                   │  DATABASE_URL (SSL)
                     ┌─────────────▼─────────────┐
                     │   PostgreSQL (managed)    │
                     └───────────────────────────┘
```

Good options per tier:

| Tier | Recommended | Alternatives |
| --- | --- | --- |
| Frontend (static) | Render Static / Vercel / Netlify / Cloudflare Pages | any static/CDN host |
| Backend (persistent Node) | Render Web Service | Railway, Fly.io, VPS+Docker |
| Database | Render Postgres | Neon, Supabase, Railway |

> The backend must be a **persistent process** (scheduler + in-memory state) — do **not** deploy it as serverless/edge functions.

**Portable alternative: single VPS + Docker Compose** (`docker-compose.yml`) — Postgres + backend + nginx-frontend on one host; put Caddy/Traefik/Cloudflare in front for HTTPS.

### Two ways the frontend reaches the backend
- **Same-origin (recommended):** frontend nginx reverse-proxies `/api` → backend. No CORS. Leave `VITE_API_URL` empty. (docker-compose is set up this way.)
- **Split-origin:** build FE with `VITE_API_URL=https://api.your-domain.com/api`, and set backend `FRONTEND_ORIGIN=https://app.your-domain.com`.

---

## 3. Environment configuration

Backend — see [`backend/.env.production.example`](backend/.env.production.example):
`NODE_ENV, PORT, DATABASE_URL (…?sslmode=require), JWT_SECRET, JWT_EXPIRES_IN, FRONTEND_ORIGIN, ERP_*`, and `ERP_SYNC_SCHEDULER_ENABLED / ERP_SYNC_INTERVAL_MS`.

Frontend — see [`frontend/.env.production.example`](frontend/.env.production.example): `VITE_API_URL` (empty for same-origin).

Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## 4. Build configuration

Backend:
```bash
npm ci
npx prisma generate
npm run build            # → dist/
npx prisma migrate deploy   # apply pending migrations (prod-safe)
node dist/main
```

Frontend:
```bash
npm ci
VITE_API_URL="https://api.your-domain.com/api" npm run build   # → dist/  (omit for same-origin)
```

---

## 5. Deployment options

### Option A — Render (Blueprint)
1. Push repo to GitHub.
2. Render → **New → Blueprint** → pick the repo (`render.yaml` auto-detected).
3. Set secrets on `wms-backend`: `ERP_BASE_URL`, `ERP_CLIENT_ID`, `ERP_CLIENT_SECRET` (JWT_SECRET auto-generated, DATABASE_URL auto-wired).
4. First deploy runs `prisma migrate deploy` (preDeployCommand).
5. Seed once (Render Shell on the backend): `npm run prisma:seed`.
6. Set `wms-frontend` env `VITE_API_URL` = `https://<wms-backend>.onrender.com/api` and redeploy.
7. Set `wms-backend` env `FRONTEND_ORIGIN` = `https://<wms-frontend>.onrender.com` and redeploy.
8. (Optional) Add custom domains; HTTPS is automatic.

### Option B — VPS + Docker Compose (same-origin)
```bash
# On the server, in the repo root:
cp backend/.env.production.example backend/.env.production   # fill in values
export POSTGRES_PASSWORD='a-strong-password'                 # used by compose + DATABASE_URL

docker compose build
docker compose up -d
docker compose exec backend npm run prisma:seed             # one-time seed
```
- App is served on port 80. Migrations run automatically on backend start.
- Put **Caddy/Traefik/Cloudflare** in front for HTTPS + your domain, forwarding to the frontend container.
- Logs: `docker compose logs -f backend`.

### Option C — Split (Vercel FE + Render/Railway BE + Neon PG)
1. Provision Postgres (Neon/Supabase) → get `DATABASE_URL` (SSL).
2. Deploy backend (Render/Railway/Fly): build `npm ci && npx prisma generate && npm run build`, release `npx prisma migrate deploy`, start `node dist/main`; set all env vars; `numInstances=1`.
3. Deploy frontend on Vercel/Netlify: build `npm run build`, output `dist`, env `VITE_API_URL=https://<backend>/api`, SPA rewrite `/* → /index.html`.
4. Set backend `FRONTEND_ORIGIN` to the FE URL.

---

## 6. Domain, CORS, HTTPS
- **HTTPS**: automatic on Render/Vercel/Netlify; on a VPS use Caddy/Traefik/Cloudflare.
- **Domain**: point `app.your-domain.com` (frontend) and, for split-origin, `api.your-domain.com` (backend) via the platform's custom-domain UI (CNAME).
- **CORS**: set `FRONTEND_ORIGIN` to the exact frontend origin(s). Same-origin (reverse proxy) needs no CORS.
- **Body size**: reverse proxies must allow ≥12 MB (already set in `nginx.conf`).

---

## 7. Deployment checklist
- [ ] `DATABASE_URL` points to production Postgres with `sslmode=require`.
- [ ] Strong `JWT_SECRET` set (not the default).
- [ ] `FRONTEND_ORIGIN` = production frontend URL (split-origin only).
- [ ] `VITE_API_URL` set at FE build (split-origin) or empty (same-origin).
- [ ] ERP secrets set; scheduler enabled on **one** instance; backend = 1 instance.
- [ ] `prisma migrate deploy` ran; `npm run prisma:seed` ran once (creates admin + permissions).
- [ ] SPA fallback / rewrite to `index.html` configured.
- [ ] HTTPS active; custom domains mapped.
- [ ] Smoke test: login (`admin` / `admin123` → change password), warehouse selector, an Oracle sync, generate a document.
- [ ] `.env` files are NOT committed.

## 8. Post-deploy notes
- Default seed login is `admin` / `admin123` — **change it immediately** in production.
- Reseeding is idempotent; run `npm run prisma:seed` after adding new permissions (e.g., new modules).
- To scale the backend beyond 1 instance later, move the ERP scheduler to a dedicated worker or keep `ERP_SYNC_SCHEDULER_ENABLED=true` on only one instance.
