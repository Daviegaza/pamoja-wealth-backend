# Pamoja Wealth — Chama Management Platform

**Building Wealth Together.** A production-grade platform for managing chamas (group savings circles), fundraisers, and community investments across East Africa.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Pamoja Wealth Platform                    │
├───────────────┬─────────────────────┬───────────────────────┤
│   Frontend    │      Backend        │    Infrastructure     │
│   React 19    │   Express 4 + TS    │   Docker + GH Actions │
│   Vite 8      │   Prisma 7.8        │   PostgreSQL 15       │
│   Tailwind 3  │   BullMQ + Redis 7  │   Redis 7             │
│   Zustand 5   │   Socket.IO 4       │   MinIO (S3)          │
└───────────────┴─────────────────────┴───────────────────────┘
```

### Key Design Decisions

| Decision | Implementation |
|----------|---------------|
| **Double-entry ledger** | Every financial operation produces balanced debit/credit entries with per-leg idempotency |
| **Idempotency** | Stripe-compliant `Idempotency-Key` header, 24h Redis TTL, body-hash collision detection |
| **Audit trail** | Hash-chained immutable audit log — any modification breaks the cryptographic chain |
| **Rate limiting** | 5 Redis-backed tiers: auth (5/min), AI (20/min), standard (100/min), upload (10/min), OTP (1/30s) |
| **RBAC** | 6 roles × 9 permissions enforced at middleware level |
| **Payment providers** | Adapter pattern supporting M-Pesa, Flutterwave, Stripe, Paystack, YellowCard, Airtel Money, MTN MoMo |
| **Job queues** | 20 BullMQ queues with dedicated workers for analytics, reminders, reconciliation, billing, and more |
| **Plan gating** | Feature flags tied to subscription tiers — returns HTTP 402 with `FEATURE_LOCKED` code |

## Quick Start

### Prerequisites
- Node.js 22+
- Docker & Docker Compose
- PostgreSQL 15 (or use the docker-compose PostgreSQL)

### Backend Setup

```bash
cd pamoja-wealth-backend

# Start infrastructure (PostgreSQL, Redis, MinIO, MailHog)
docker compose up -d

# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Push database schema
npx prisma db push

# Seed demo data (12 users, 6 chamas, transactions, loans, votes, donations)
npm run db:seed

# Start development server
npm run dev
# → API at http://localhost:3000/api/v1
# → Swagger docs at http://localhost:3000/api/v1/docs
# → Metrics at http://localhost:3000/api/v1/metrics
# → WebSocket at ws://localhost:3000/ws
```

### Frontend Setup

```bash
cd pamoja-wealth

# Install dependencies
npm install

# Set up environment
echo "VITE_API_BASE_URL=http://localhost:3000/api/v1" > .env

# Start development server
npm run dev
# → App at http://localhost:5173
```

To run with mock data (no backend needed):
```bash
echo "VITE_USE_MOCKS=true" >> .env
```

### Demo Credentials

All seeded users use password **`Demo1234!`**.

| Role | Email | Notes |
|------|-------|-------|
| Owner-admin | `admin@pamoja.app` | Platform admin (kycLevel 3) |
| Founder | `amara@pamoja.app` | Owns Westlands Real Estate; secretary of Mwananchi |
| Chair | `brian@pamoja.app` | Owns Mwananchi Savers Club |
| Treasurer | `caro@pamoja.app` | Owns Wanjiru's Graduation Fund |
| Welfare lead | `esther@pamoja.app` | Owns Family Welfare Network |
| Invitee | `kendi@pamoja.app` | Has pending username invitation to Westlands |
| Diaspora | `faraj@pamoja.app` | Westlands member, based in UK |

## API Overview

All endpoints are under `/api/v1/`.

| Group | Key Endpoints |
|-------|--------------|
| **Auth** | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` |
| **Users** | `GET /users/me`, `PATCH /users/me`, `GET /users/:id` |
| **Chamas** | `GET /chamas/discover`, `POST /chamas`, `GET /chamas/:id`, `POST /chamas/:id/join` |
| **Wallet** | `GET /wallet`, `POST /wallet/deposit`, `POST /wallet/withdraw` |
| **Loans** | `GET /loans`, `POST /loans`, `POST /loans/:id/repay` |
| **Investments** | `GET /investments`, `POST /investments` |
| **Meetings** | `GET /meetings`, `POST /meetings`, `POST /meetings/:id/rsvp` |
| **Votes** | `GET /votes`, `POST /votes`, `POST /votes/:id/ballot` |
| **Chat** | `GET /chat/:chamaId/messages`, WebSocket at `/ws` |
| **Notifications** | `GET /notifications`, `PATCH /notifications/:id/read` |
| **Billing** | `GET /billing/plans`, `POST /billing/subscribe` |
| **KYC** | `POST /kyc/upload`, `GET /kyc/status` |
| **Payouts** | `POST /payouts`, `POST /payouts/:id/sign` |

Full API documentation: `http://localhost:3000/api/v1/docs`

## Project Structure

### Backend (`pamoja-wealth-backend`)

```
src/
├── config/          # Database, Redis, logger, storage, Swagger, Sentry, metrics
├── controllers/     # 18 HTTP request handlers
├── middleware/       # Auth, RBAC, validation, rate-limit, idempotency, audit,
│                      error-handler, plan-gate, webhook-guard, correlation-id
├── routes/          # 30+ route modules
├── services/        # 50+ business logic services
│   └── payment-providers/  # M-Pesa, Flutterwave, Stripe, Paystack, etc.
├── jobs/
│   ├── queue.ts     # 20 BullMQ queue definitions
│   ├── scheduler.ts # Cron job registration
│   └── workers/     # Job processors
├── validators/      # Zod validation schemas
├── websocket/       # Socket.IO server with auth + room management
├── utils/           # JWT, crypto, pagination, error helpers
└── lib/             # Circuit breaker, rule engine
```

### Frontend (`pamoja-wealth`)

```
src/
├── api/             # 18 API modules matching backend domains
├── components/      # UI primitives, cards, charts, forms, dialogs, layout
├── hooks/           # 22 custom hooks (wrapping Zustand stores)
├── pages/           # 34 page-level route components
├── stores/          # 14 Zustand stores (auth, chama, wallet, loan, etc.)
├── routes/          # React Router v6 configuration with lazy loading
├── schemas/         # Zod form validation schemas
├── providers/       # QueryClient, Theme, Toast providers
├── lib/             # Utilities, socket client, PWA, i18n
├── i18n/            # English, Kiswahili, French translations
└── mock/            # Mock data layer (1k users, 200 chamas) for dev without backend
```

## Testing

### Backend
```bash
npm test                  # Jest unit + integration tests
npm run test:watch        # Watch mode
```

### Frontend
```bash
npm test                  # Vitest unit tests
npm run test:e2e          # Playwright E2E tests
npm run test:e2e:ui       # Playwright with UI
npm run test:smoke        # Standalone smoke test (no Playwright)
```

### Load Testing
```bash
cd backend/load
k6 run smoke.js           # 1 VU, 30s smoke test
k6 run contribute.js      # Contribution flow load test
```

## Production Deployment

```bash
# Build and run with Docker Compose (production profile)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# The production compose file includes:
# - Backend API + Worker (from ghcr.io)
# - Frontend (React build served via Nginx)
# - PostgreSQL 15 + daily backups
# - Redis 7 (256mb memory limit)
```

## Environment Variables

See `.env.example` for all configuration options. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | JWT signing secret (min 32 chars in production) |
| `JWT_REFRESH_SECRET` | Refresh token signing secret |
| `MPESA_*` | M-Pesa Daraja API credentials |
| `S3_*` | S3-compatible storage (MinIO in dev) |
| `SENTRY_DSN` | Optional Sentry error tracking |
| `FEATURE_*` | Feature flags for phased rollouts |

## Competitive Advantage

| Feature | Pamoja Wealth | Chamasoft | M-Changa |
|---------|---------------|-----------|----------|
| Double-entry ledger | ✅ | ❌ | ❌ |
| Hash-chained audit | ✅ | ❌ | ❌ |
| Platform fee | 0.5% capped | Unknown | 4.25-15% |
| Multi-signature payouts | ✅ | ❌ | ❌ |
| AI rule compiler | ✅ | ❌ | ❌ |
| Real-time WebSocket | ✅ | ❌ | ❌ |
| Kiswahili + French | ✅ | Partial | Partial |
| Multi-rail payments | Planned | Limited | M-Pesa only |

## License

Private — all rights reserved.
