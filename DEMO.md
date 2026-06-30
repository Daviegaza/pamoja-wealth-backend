# Pamoja Wealth — Demo Quickstart

Connected stack: frontend (`/home/davie/WebstormProjects/pamoja-wealth`) + backend (this repo). Seeded with 12 users, 6 chamas/fundraisers across all privacy modes, transactions, loans, votes, donations, and pending invitations (phone / username / email).

## Run

```bash
# Backend (this repo)
docker compose up -d
npx prisma db push --accept-data-loss   # if schema not yet pushed
npm run db:seed                          # seed 12 users + 6 chamas + invitations
npm run dev                              # :3000

# Frontend
cd ../pamoja-wealth
echo "VITE_API_BASE_URL=http://localhost:3000/api/v1" > .env
npm run dev                              # :5173
```

Compose ports: postgres **5544**, redis **6479**, MinIO **9100/9101**, Mailhog **1125/8125**.

## Demo credentials

All seeded users use password **`Demo1234!`**.

| Role         | Email               | Notes                                                    |
|--------------|---------------------|----------------------------------------------------------|
| Owner-admin  | `admin@pamoja.app`  | Platform admin (kycLevel 3)                              |
| Founder      | `amara@pamoja.app`  | Owns Westlands Real Estate; secretary of Mwananchi       |
| Chair        | `brian@pamoja.app`  | Owns Mwananchi Savers Club                               |
| Treasurer    | `caro@pamoja.app`   | Owns Wanjiru's Graduation Fund (invite-only fundraiser)  |
| Welfare lead | `esther@pamoja.app` | Owns Family Welfare Network (private)                    |
| Invitee      | `kendi@pamoja.app`  | Has a pending **username invitation** to Westlands       |
| Diaspora     | `faraj@pamoja.app`  | Westlands member, based in UK                            |

## Seeded scenarios that exercise every feature

| Chama                                | Type        | Privacy      | Demonstrates                              |
|---|---|---|---|
| **Mwananchi Savers Club**            | chama       | public       | Open-discovery + monthly contributions + vote + meeting + chat |
| **Westlands Real Estate Chama**      | chama       | invite_only  | Token invites by phone + username + active loan + real-estate investment |
| **Family Welfare Network**           | chama       | private      | Join-request workflow (Ivy has a pending request) + email invitation |
| **Coast Boda-Boda SACCO Pilot**      | chama       | public       | Mixed-mode category, public discoverable                  |
| **Mama Asha Cancer Treatment Appeal**| fundraiser  | public       | 7 donations (5 named + 2 anonymous) toward 850k target    |
| **Wanjiru's Graduation Fund**        | fundraiser  | invite_only  | Family-only fundraiser, 200k target                       |

## Key API surface (new in this pass)

```
GET    /api/v1/chamas/discover                       # public chamas + fundraisers
GET    /api/v1/chamas/my-invitations                 # my pending invitations across all chamas
POST   /api/v1/chamas/invitations/accept             # body: { token }
POST   /api/v1/chamas/invitations/decline            # body: { token }
POST   /api/v1/chamas/:id/invite                     # body: { method, phone?|email?|username?, message?, expiresInDays }
GET    /api/v1/chamas/:id/invitations                # admin: list pending
GET    /api/v1/chamas/:id/search-users?q=…           # invite autocomplete
GET    /api/v1/chamas/:id/join-requests              # admin: incoming requests
POST   /api/v1/chamas/:id/join-requests/:rid/decision  # body: { decision: approved|rejected }
POST   /api/v1/chamas/:id/donate                     # fundraiser donations
GET    /api/v1/chamas/:id/donations                  # donor wall
```

`POST /chamas/:id/join` body now accepts `{ inviteCode? }`, `{ invitationToken? }`, or empty body (public auto-join; private creates a join request).

## What's still TODO ("best of the best" roadmap)

Mechanics are wired — payments are stubbed, integrations flags-off. Wire these to compete with Chamasoft, M-Changa, FNB Stokvel, Esusu, Moneyfellows, etc.

### Tier 1 — must-ship for parity (Kenya)
1. **M-Pesa STK Push** contributions (`FEATURE_MPESA_ENABLED=true`, Daraja creds in `.env`). Callback handler exists at `POST /wallet/deposit/mpesa-callback`.
2. **M-Pesa B2C payout** for share-out / rotation / loan disbursement.
3. **Multi-rail support**: Airtel Money + T-Kash + Pesalink (so non-Safaricom members aren't locked out).
4. **SMS deep-link invites** via Africa's Talking for phone-method invitations (TODO comment in `chamas.service.ts:invite`).
5. **In-app notification** push for username-method invitations resolved to a user.
6. **KYC at member + group level**: ID + selfie liveness, optional Huduma / National-ID lookup. Field `User.kycLevel` already exists.
7. **Multi-signature withdrawals** on group wallet (configurable n-of-m approvers).
8. **Bilingual UX** (English + Kiswahili) + SMS fallback notifications for feature-phone members.
9. **Loan repayment cron**: BullMQ job to detect overdue → set status `overdue` → notify borrower + guarantors.
10. **Real-time transparency ledger** stream (WebSocket initialized, no event publisher yet).

### Tier 2 — differentiators ("best in class")
11. **Diaspora on-ramp**: LemFi / NALA / Wise integration so UK/US/CA members fund KES contributions in one tap.
12. **Escrow-by-default holding account**: funds never sit in treasurer's personal M-Pesa.
13. **Credit-building reporting** (Esusu pattern): partner with Metropol / TransUnion / CRB Kenya to report on-time chama contributions.
14. **AI treasurer-anomaly detection**: flag off-platform collection attempts, cadence breaks, suspicious officer changes.
15. **Cross-chama discovery + investment marketplace**: federated directory of investment chamas (land, money-market, SACCO shares).

### Tier 3 — compliance
16. **Kenya DPA 2019** Data Controller registration + DPIA + in-app erasure flow.
17. **CBK Non-Deposit Taking Credit Providers Regulations 2025** registration if loans extend beyond member-to-group internal lending.
18. **SACCO Societies (Amendment) Bill 2023** alignment when SACCO Central remittance rails open.
19. **AML/CFT/CPF**: transaction monitoring + STR reporting hooks.

### Frontend polish remaining
- `InviteMembersDialog` with method tabs (phone book / @username / email / QR / link).
- `CreateChamaForm` privacy radios + fundraiser toggle (target + deadline) — backend accepts, UI controls needed.
- Fundraiser detail page with donor wall + progress bar + share/QR.
- `JoinRequestsAdmin` panel on Chama detail (endpoint is live).
- Member KYC upload widget.

## Research basis

Global analogs surveyed: Kenya chamas (Chamasoft, M-Changa, MyChama.app, Kuza), West Africa susu/ajo/esusu/tontine, Southern Africa stokvel (R50bn/yr, NASASA), India chit funds (Chit Funds Act 1982), Latin America tanda/cundina/junta, East/SE Asia hui/kye/tanomoshi/paluwagan/arisan, diaspora apps (Esusu, Moneyfellows, eMoneyPool, TrustAjo, Kitpot), fundraiser platforms (GoFundMe, Givebutter, Chuffed, M-Changa). Payment rails: Daraja STK Push + B2C, Pesalink, LemFi, NALA, Wise. Trust controls: multisig wallets, escrow, KYC, behavioural alerts. Regulatory: Kenya SACCO Bill 2023, CBK DCP regime, DPA 2019, AML/CFT/CPF.
