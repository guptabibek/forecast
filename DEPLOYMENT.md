# Deployment Guide

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Option 1: Docker Compose (recommended)](#option-1-docker-compose)
- [Option 2: Standalone Deployment](#option-2-standalone-deployment)
  - [Backend (API)](#backend-api)
  - [Frontend (Web) on IIS](#frontend-web-on-iis)
  - [Frontend (Web) on nginx](#frontend-web-on-nginx)
- [Database Setup](#database-setup)
- [Redis (optional)](#redis-optional)
- [SSL / Reverse Proxy](#ssl--reverse-proxy)

---

## Prerequisites

| Component | Required | Notes |
|-----------|----------|-------|
| Node.js 20+ | Yes | LTS recommended |
| PostgreSQL 14+ | Yes | External or managed |
| Redis 7+ | **Optional** | Required only for background job queues (forecast runs, data imports, Marg sync). Without Redis the app runs fully but these operations are unavailable. |

---

## Environment Variables

Copy `.env.production.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | 32+ char random string |
| `JWT_REFRESH_SECRET` | Yes | 32+ char random string |
| `CORS_ORIGINS` | Yes | Comma-separated allowed origins |
| `FRONTEND_URL` | Yes | Public URL of the web app |
| `MAIN_DOMAIN` | Yes | Base domain for tenant subdomains |
| `ENCRYPTION_KEY` | Yes | 32-char hex string for field encryption |
| `REDIS_HOST` | No | Redis hostname. Omit to disable Redis. |
| `REDIS_PORT` | No | Redis port (default 6379) |
| `REDIS_PASSWORD` | No | Redis auth password |
| `REDIS_URL` | No | Full Redis URL (alternative to host/port) |
| `API_PORT` | No | API listen port (default 3000) |
| `NODE_ENV` | No | `production` or `development` |
| `SMTP_*` | No | SMTP settings for email notifications |
| `OPENAI_API_KEY` | No | OpenAI key for AI forecast models |
| `VITE_API_URL` | Build-time | API base path for frontend (default `/api/v1`) |

---

## Option 1: Docker Compose

The fastest way to deploy. Redis is included as an optional profile.

### Without Redis (minimal)

```bash
cp .env.production.example .env
# Edit .env with your values (no REDIS_HOST needed)

docker compose --env-file .env up -d --build
```

### With Redis (background queues enabled)

```bash
# Set REDIS_HOST=redis in your .env file, then:
docker compose --env-file .env --profile redis up -d --build
```

Database migrations run automatically on API startup via the entrypoint script.

### Updating

```bash
git pull
docker compose --env-file .env up -d --build
# Or with Redis:
docker compose --env-file .env --profile redis up -d --build
```

---

## Option 2: Standalone Deployment

Deploy the API and frontend independently — useful for Windows servers, IIS, or when Docker is unavailable.

### Backend (API)

#### Build

```bash
cd apps/api
npm ci --production=false
npx prisma generate
npm run build
```

#### Apply Database Migrations

Run this on every deployment to apply new schema changes:

```bash
cd apps/api
npx prisma migrate deploy
```

On a **fresh database** this creates all tables from scratch. On an existing database it applies only pending migrations.

#### Start

```bash
# Linux / macOS
cd apps/api
NODE_ENV=production node dist/main.js

# Windows (PowerShell)
cd apps\api
$env:NODE_ENV="production"
node dist\main.js
```

For production, use a process manager:

```bash
# PM2 (cross-platform)
npm install -g pm2
cd apps/api
pm2 start dist/main.js --name forecast-api --env production

# Windows Service (using node-windows or NSSM)
nssm install ForecastAPI "C:\Program Files\nodejs\node.exe" "D:\apps\forecast-saas\apps\api\dist\main.js"
nssm set ForecastAPI AppDirectory "D:\apps\forecast-saas\apps\api"
nssm set ForecastAPI AppEnvironmentExtra "NODE_ENV=production" "DATABASE_URL=..." "JWT_SECRET=..."
```

#### Environment

Set environment variables via `.env` file in `apps/api/`, system environment, or process manager config.

---

### Frontend (Web) on IIS

The frontend is a static single-page application (SPA). After building, it produces plain HTML/JS/CSS files.

#### Build

```bash
cd apps/web
npm ci
# Set the API URL the frontend will call:
set VITE_API_URL=/api/v1
npm run build
```

The built files are in `apps/web/dist/`.

#### Deploy to IIS

1. **Install IIS** with the **URL Rewrite** module ([download](https://www.iis.net/downloads/microsoft/url-rewrite))
2. Create a new IIS site pointing to the `dist/` folder
3. Copy `apps/web/web.config` into the site root (already included in the repo)
4. Configure the API reverse proxy:
   - If the API runs on the same server, uncomment the proxy rule in `web.config` and set the target URL
   - Or use **Application Request Routing (ARR)** to proxy `/api/*` to `http://localhost:4001/api/*`

#### IIS Reverse Proxy for API

```xml
<!-- In web.config, uncomment and adjust: -->
<rule name="API Proxy" stopProcessing="true">
  <match url="^api/(.*)" />
  <action type="Rewrite" url="http://localhost:4001/api/{R:1}" />
</rule>
```

Requires ARR: `Install-WindowsFeature Web-Server, Web-WebSockets` and the ARR module.

---

### Frontend (Web) on nginx

```nginx
server {
    listen 80;
    server_name planning.example.com *.planning.example.com;
    root /var/www/forecast-web;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reverse proxy API
    location /api/ {
        proxy_pass http://127.0.0.1:4001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache hashed assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## Database Setup

### Fresh Database

Prisma handles full schema creation automatically:

```bash
cd apps/api
npx prisma migrate deploy
```

This applies **all** migrations in order, creating every table, index, and constraint from scratch.

### Verify Schema

```bash
cd apps/api
npx prisma migrate status
```

### Seed Initial Data (optional)

After migrations, seed the super-admin tenant:

```bash
cd apps/api
npx prisma db seed
```

---

## Redis (optional)

Redis powers background job queues (BullMQ) for:
- Forecast engine runs
- Data file imports
- Marg EDE sync jobs
- Tenant-scoped caching (performance optimization)

**Without Redis:** The app starts normally. All CRUD operations, dashboards, reports, settings, and user management work. Background processing features (forecast runs, imports) are unavailable and return clear error messages.

**With Redis:** Set `REDIS_HOST` (and optionally `REDIS_PORT`, `REDIS_PASSWORD`) in your environment. The app will connect to Redis for queues and caching.

### Managed Redis

For production, use a managed Redis service (AWS ElastiCache, Azure Cache for Redis, etc.):

```env
REDIS_HOST=your-redis-host.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your-auth-token
```

---

## SSL / Reverse Proxy

In production, always terminate SSL at a reverse proxy (nginx, IIS ARR, Caddy, or a cloud load balancer) in front of both the API and web services.

Example with Caddy (automatic HTTPS):

```
planning.example.com {
    root * /var/www/forecast-web
    file_server
    try_files {path} /index.html

    reverse_proxy /api/* localhost:4001
}
```
