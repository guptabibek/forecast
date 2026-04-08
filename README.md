# ForecastHub - Multi-Tenant SaaS Planning & Forecasting Platform

## Overview

ForecastHub is an enterprise-grade, multi-tenant SaaS platform for financial planning, forecasting, and scenario analysis. It enables organizations to upload historical actuals, generate forecasts using multiple statistical and AI-powered models, and manage versioned plans with full audit trails.

## Key Features

- **Multi-Tenant Architecture**: Complete data isolation with tenant-aware queries
- **ERP-Agnostic Data Ingestion**: API, CSV, Excel upload with schema mapping
- **Pluggable Forecast Engine**: 6+ forecast models with easy extensibility
- **Scenario Planning**: Create, compare, and analyze multiple scenarios
- **Version Control**: Full plan versioning with lock/approval workflows
- **RBAC Security**: Role-based access control with JWT authentication
- **Audit Logging**: Complete audit trail for compliance

## Tech Stack

### Backend
- **Runtime**: Node.js 20+
- **Framework**: NestJS 10+
- **ORM**: Prisma 5+
- **Database**: PostgreSQL 15+
- **Queue**: BullMQ with Redis
- **Auth**: JWT + Passport

### Frontend
- **Framework**: React 18+ with TypeScript
- **State**: Zustand + React Query
- **UI**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts / Apache ECharts
- **Forms**: React Hook Form + Zod

### Infrastructure
- **Container**: Docker + Docker Compose
- **Cloud**: AWS/GCP/Azure ready
- **CI/CD**: GitHub Actions

## Project Structure

```
forecast-saas/
├── apps/
│   ├── api/                    # NestJS Backend
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/       # Authentication & RBAC
│   │   │   │   ├── tenants/    # Tenant management
│   │   │   │   ├── users/      # User management
│   │   │   │   ├── actuals/    # Historical data ingestion
│   │   │   │   ├── plans/      # Plan versioning
│   │   │   │   ├── forecasts/  # Forecast generation
│   │   │   │   ├── scenarios/  # Scenario management
│   │   │   │   ├── dimensions/ # Dimension management
│   │   │   │   └── audit/      # Audit logging
│   │   │   ├── core/
│   │   │   │   ├── database/   # Prisma setup
│   │   │   │   ├── queue/      # BullMQ jobs
│   │   │   │   └── common/     # Shared utilities
│   │   │   └── forecast-engine/# Pluggable forecast models
│   │   └── prisma/
│   │       └── schema.prisma
│   │
│   └── web/                    # React Frontend
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── hooks/
│       │   ├── services/
│       │   └── stores/
│       └── package.json
│
├── packages/
│   └── shared/                 # Shared types & utilities
│
├── docker-compose.yml
└── README.md
```

## Quick Start

```bash
# Clone repository
git clone https://github.com/your-org/forecast-saas.git
cd forecast-saas

# Install dependencies
npm install

# Start infrastructure
docker-compose up -d postgres redis

# Run migrations
npm run db:migrate

# Seed demo data
npm run db:seed

# Start development
npm run dev
```

## Single-Command Docker UAT Deployment

You can deploy frontend, backend, PostgreSQL, and Redis together with one command from the repository root.

```bash
# 1) From repo root, start all services
npm run uat:up

# 2) Optional: seed demo data (admin@demo.com / Admin123!)
npm run uat:seed
```

Services after startup:

- Web: `http://localhost:3080`
- API: `http://localhost:3101`
- API Health: `http://localhost:3101/health`

Other useful commands:

```bash
npm run uat:ps      # service status
npm run uat:logs    # stream logs
npm run uat:down    # stop and remove containers
npm run uat:reset   # stop and remove containers + volumes
```

Configuration is loaded from `.env.docker`.

Build note: both `api` and `web` Docker images are built from the single root `Dockerfile` using build targets (`api-runtime`, `web-runtime`).

## Production Deployment

### Using Docker Compose

```bash
# 1. Copy and configure environment
cp .env.production.example .env

# 2. Edit .env with your production values
# - Set strong passwords for POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET
# - Update CORS_ORIGINS and FRONTEND_URL with your domain
# - Add OPENAI_API_KEY for AI forecasting features

# 3. Build and start services
docker-compose -f docker-compose.prod.yml up -d --build

# 4. Run database migrations
docker-compose exec api npx prisma migrate deploy

# 4a. Regenerate Prisma client
docker-compose exec api npx prisma generate

# 5. Seed initial data (optional)
docker-compose exec api npx prisma db seed
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | Yes | Database password |
| `JWT_SECRET` | Yes | JWT signing secret (32+ chars) |
| `JWT_REFRESH_SECRET` | Yes | Refresh token secret (32+ chars) |
| `CORS_ORIGINS` | Yes | Allowed frontend origins |
| `FRONTEND_URL` | Yes | Frontend URL for redirects |
| `OPENAI_API_KEY` | No | OpenAI key for AI forecasting |

### Health Checks

- **API**: `GET /health` - Returns service health status
- **Web**: `GET /health` - Returns nginx health status

- [Database Schema](./docs/DATABASE.md)
- [API Reference](./docs/API.md)
- [Forecast Models](./docs/FORECAST_MODELS.md)
- [Deployment Guide](./docs/DEPLOYMENT.md)

## End-to-End Testing (Frontend + Backend)

### Prerequisites

**Windows hosts file** – `demo.localhost` must resolve to `127.0.0.1`.  
Open `C:\Windows\System32\drivers\etc\hosts` as Administrator and add:
```
127.0.0.1 demo.localhost
```

### Demo Credentials (seeded)
| Field    | Value             |
|----------|-------------------|
| Email    | `admin@demo.com`  |
| Password | `Admin123!`       |
| URL      | `http://demo.localhost:3000` |

### Running E2E tests
```bash
# Terminal 1 – Start API
cd apps/api
npm run start:dev

# Terminal 2 – Run all E2E tests
cd apps/web
npm install
npx playwright install chromium   # first time only
npm run e2e
```

### Test projects
| Project         | What it covers                                     |
|-----------------|----------------------------------------------------|
| `setup`         | One-time login → saves session to `playwright/.auth/user.json` |
| `public`        | Auth pages (login, register, forgot-password, route guards) |
| `authenticated` | All protected modules (dashboard, plans, forecasts, manufacturing, …) |

### Test files
| File                            | Module                         | Tests |
|---------------------------------|--------------------------------|-------|
| `e2e/global-setup.ts`           | Session bootstrap               | 1     |
| `e2e/app-smoke.e2e.spec.ts`     | Backend health + basic guards  | 3     |
| `e2e/01-auth.e2e.spec.ts`       | Login / Register / Route guards| 15    |
| `e2e/02-dashboard.e2e.spec.ts`  | Dashboard KPIs / filters        | 6     |
| `e2e/03-plans.e2e.spec.ts`      | Plans list + Create Plan form  | 5     |
| `e2e/04-forecasts.e2e.spec.ts`  | Forecasts list + selectors     | 4     |
| `e2e/05-scenarios.e2e.spec.ts`  | Scenarios list + create modal  | 4     |
| `e2e/06-data.e2e.spec.ts`       | Product Master / Actuals / Dimensions / Import | 7 |
| `e2e/07-manufacturing.e2e.spec.ts` | Suppliers (400 regression) / BOM / MRP / 10+ pages | 20+ |
| `e2e/08-reports.e2e.spec.ts`    | Reports page + export          | 3     |
| `e2e/09-settings.e2e.spec.ts`   | Settings / Users / Profile / Audit Log | 9 |

### Where to review errors
| Artifact | Location |
|----------|----------|
| Runtime browser/network errors (NDJSON) | `apps/web/test-results/e2e/runtime-errors.ndjson` |
| JUnit XML (CI-compatible) | `apps/web/test-results/e2e/junit.xml` |
| JSON summary | `apps/web/test-results/e2e/results.json` |
| HTML report (screenshots, traces, video) | `apps/web/playwright-report/index.html` |
| Auth session state | `apps/web/playwright/.auth/user.json` |

### Helpers
```bash
# Open HTML report after a run
cd apps/web && npm run e2e:report

# Run in headed mode (watch tests execute)
npm run e2e:headed

# Override credentials or URL
E2E_WEB_URL=http://demo.localhost:3000 \
E2E_API_URL=http://localhost:3001 \
E2E_ADMIN_EMAIL=admin@demo.com \
E2E_ADMIN_PASSWORD=Admin123! \
npm run e2e
```



## License

MIT License - See LICENSE file for details
