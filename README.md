# Pamoja Wealth — backend

Record-keeping API for chamas (group savings). **Non-custodial:** Pamoja never
holds, receives or transfers members' money. Members pay directly into the
chama's own M-Pesa Paybill/Till or bank account; officers record those payments
here, members confirm or dispute them, and every change lands in a
hash-chained audit log. Pamoja's only revenue is a flat SaaS subscription per
chama.

## What the API does

| Area | Endpoints (under `/api/v1`) |
|------|------------------------------|
| Auth | `/auth/register`, `/auth/login`, `/auth/refresh` (single-use, replay revokes all sessions), `/auth/logout`, OTP + password reset |
| Me | `GET/PATCH /users/me`, `GET/PATCH /settings`, `/notifications` |
| Chamas | `GET/POST /chamas`, `POST /chamas/join`, `GET/PATCH/DELETE /chamas/:chamaId` |
| Members | `/chamas/:chamaId/members`, `/members/:userId` (role / remove), `/invite-codes` |
| Contributions | `/contribution-schedules`, `/contributions` (record), `/:id/confirm`, `/:id/dispute`, `/:id/void`, `/contributions/summary` |
| Goals | `/chamas/:chamaId/goals` (progress derived from recorded contributions) |
| Loan register | `/chamas/:chamaId/loans`, `/loans/:loanId/repayments`, `/loans/:loanId/status` |
| Meetings | `/chamas/:chamaId/meetings`, `/:meetingId/minutes`, `/:meetingId/rsvp` |
| Statements | `/statements/chama`, `/statements/members/:userId` — `?format=json|csv|pdf&from&to` |
| Audit | `/chamas/:chamaId/audit` |
| Billing | `GET /billing/plans`, `/chamas/:chamaId/subscription` (+ `/checkout`, `/verify`, `/cancel`), `/invoices`, webhooks `/webhooks/flutterwave`, `/webhooks/paystack` |

### Authorization model

- Roles per chama: `chairperson`, `treasurer`, `secretary`, `member`
  (legacy `owner`/`admin` behave as chairperson).
- Every `/chamas/:chamaId/*` route runs `requireChamaMember` (active membership
  of that chama, otherwise **404**) and, where needed, `requireChamaRole`
  (otherwise **403**). Child records are always looked up with
  `{ id, chamaId }`, so ids from another chama are 404.
- Money records (contributions, loans, repayments): chairperson/treasurer.
  Meetings, minutes, invite codes: chairperson/secretary. Roles, loan status,
  archive: chairperson. Only the member a contribution belongs to can confirm
  or dispute it. Members see only their own contributions, loans and
  statements; officers see everyone's.

### Subscription payments

Checkout creates an open invoice with our own reference and returns the
provider's hosted checkout URL. A subscription is activated **only** after a
server-to-server verify call to Flutterwave/Paystack confirms a successful KES
charge of at least the invoice amount for that reference. Webhook bodies and
redirect parameters only trigger that verification; they are never trusted.
Webhook signatures fail closed in every environment.

## Development

```bash
docker compose up -d postgres redis   # or your own local Postgres + Redis
npm install
cp .env.example .env                   # dev defaults work without secrets
npx prisma migrate deploy
npm run db:seed                        # plans + a small demo chama (refuses in production)
npm run dev
```

### Checks

```bash
npm run typecheck
npm run lint          # --max-warnings 0
npm test              # needs Postgres + Redis, see below
npm run build
```

Tests are integration tests against a real, throwaway Postgres + Redis. By
default they use `postgresql://pamoja:test@127.0.0.1:55433/pamoja_test` and
`redis://127.0.0.1:56379` (override with `TEST_DATABASE_URL` /
`TEST_REDIS_URL`); migrations are applied automatically. **The test run
truncates tables — never point it at a real database.**

```bash
docker run -d --name pamoja-test-pg -e POSTGRES_USER=pamoja -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=pamoja_test -p 127.0.0.1:55433:5432 postgres:16-alpine
docker run -d --name pamoja-test-redis -p 127.0.0.1:56379:6379 redis:7-alpine
```

## Database notes

The 2026-11 non-custodial pivot added `contribution_schedules`,
`contribution_records`, `loan_repayment_records` and a few nullable columns in
an additive migration. Tables from removed features (wallets, payouts, ledger,
investments, donations, KYC, etc.) are left in place untouched — no
destructive migration — but nothing in the API reads or writes them.

## Production configuration

`JWT_SECRET`, `JWT_REFRESH_SECRET` (>= 32 chars), `ENCRYPTION_KEY` (64 hex)
and `DATABASE_URL` are mandatory in production; the process exits if any is
missing or weak. Redis is mandatory in production. See `.env.example`.
