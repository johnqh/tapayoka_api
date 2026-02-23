# tapayoka_api

Backend API for Tapayoka QR-to-device cashless payment system. Hono + Bun + Drizzle + PostgreSQL.

## Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Database**: PostgreSQL with Drizzle ORM
- **Auth**: Firebase Admin SDK (token verification)
- **Crypto**: ethers.js (ETH wallet signing/verification)
- **Payments**: Stripe
- **Validation**: Zod

## Commands

```bash
bun install          # Install deps
bun run dev          # Dev server with watch (port 3000)
bun run start        # Production start
bun run build        # Build for production
bun run test         # Run tests (vitest)
bun run typecheck    # Type check
bun run lint         # ESLint
bun run db:migrate   # Run database migrations
```

## API Routes

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/api/v1/health` | No | Health check |
| `/api/v1/buyer/devices` | Firebase (buyer) | Verify device, get services |
| `/api/v1/buyer/orders` | Firebase (buyer) | Create order, pay, get status |
| `/api/v1/buyer/authorizations` | Firebase (buyer) | Get signed authorization |
| `/api/v1/buyer/telemetry` | Firebase (buyer) | Report device events |
| `/api/v1/vendor/devices` | Firebase (vendor) | Device CRUD, service assignment |
| `/api/v1/vendor/services` | Firebase (vendor) | Service/product CRUD |
| `/api/v1/vendor/orders` | Firebase (vendor) | Order monitoring, stats |
| `/api/v1/vendor/entities` | Firebase (vendor) | Entity management |
| `/api/v1/vendor/qr` | Firebase (vendor) | QR code generation |

## Database

PostgreSQL schema `tapayoka` with tables: users, devices, services, device_services, orders, authorizations, device_logs, admin_logs.

Device primary key is `wallet_address` (ETH address). Auto-initializes on startup via `initDatabase()`.

## Key Environment Variables

- `DATABASE_URL` — PostgreSQL connection string
- `SERVER_ETH_PRIVATE_KEY` — Server's Ethereum private key
- `STRIPE_SECRET_KEY` — Stripe API key
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

## Architecture

- Routes split: `/buyer` (purchase flow) and `/vendor` (management)
- Firebase auth middleware verifies tokens, auto-creates user records
- Role guard middleware enforces vendor/buyer role separation
- ETH crypto: server signs authorizations, verifies device signatures
- Drizzle ORM for type-safe queries, raw SQL for schema init
