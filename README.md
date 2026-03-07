# tapayoka_api

Backend API server for Tapayoka, a QR-to-device cashless payment system.

## Setup

```bash
bun install
# Configure .env.local with DATABASE_URL, Firebase, SERVER_ETH_PRIVATE_KEY, STRIPE_SECRET_KEY
bun run db:migrate   # Run database migrations
bun run dev          # Start dev server (port 3000)
```

## Routes

| Prefix | Auth | Purpose |
|--------|------|---------|
| `/api/v1/health` | None | Health check |
| `/api/v1/buyer/devices` | Firebase | Verify device, get services |
| `/api/v1/buyer/orders` | Firebase | Create order, pay, get status |
| `/api/v1/buyer/authorizations` | Firebase | Get signed authorization |
| `/api/v1/buyer/telemetry` | Firebase | Report device events |
| `/api/v1/vendor/devices` | Firebase | Device CRUD, service assignment |
| `/api/v1/vendor/services` | Firebase | Service/product CRUD |
| `/api/v1/vendor/orders` | Firebase | Order monitoring, stats |
| `/api/v1/vendor/entities` | Firebase | Entity management |
| `/api/v1/vendor/qr` | Firebase | QR code generation |

## Stack

Bun, Hono, PostgreSQL + Drizzle ORM, Firebase Admin SDK, ethers.js (ETH wallet signing), Stripe, Zod.

## Development

```bash
bun run dev          # Dev server with hot reload
bun run test         # Run Vitest
bun run typecheck    # TypeScript check
bun run lint         # ESLint
bun run build        # Build for production
```

## Related Packages

- `@sudobility/tapayoka_types` -- Shared type definitions
- `tapayoka_buyer_app_rn` -- Buyer mobile app
- `tapayoka_vendor_app` -- Vendor web dashboard
- `tapayoka_pi` / `tapayoka_pi_pico` -- Device firmware

## License

BUSL-1.1
