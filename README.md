# Monitor - Trading Dashboard

Real-time multi-exchange trading dashboard for monitoring positions, orders, and account equity across AsterDex and OKX exchanges.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev

# Access dashboard
open http://localhost:3000
```

## Features

- ✅ **Multi-Exchange Support** - AsterDex & OKX (Phase 2 complete)
- ✅ **Real-time Monitoring** - Live positions, orders, equity tracking
- ✅ **Grid Trading Visualization** - Display and manage grid levels
- ✅ **External RESTful API** - Third-party integrations via API keys
- ✅ **Automated Data Collection** - Vercel cron jobs (every 1 min)
- ✅ **Secure Authentication** - NextAuth.js for dashboard, API keys for external access

## Architecture

```
Next.js 15 + React 19 + TypeScript
├── Redis (data persistence)
├── Directus (account management)
├── Backend-Cron (trade execution proxy)
└── Vercel (deployment + cron jobs)
```

## Environment Variables

Create `.env.local` with:

```env
# Directus CMS
DIRECTUS_URL=https://your-directus.com
DIRECTUS_TOKEN=your-admin-token

# Redis
REDIS_URL=redis://default:password@host:port/db

# Backend-Cron Integration
BACKEND_CRON_URL=http://backend-cron-server:3001
WEBHOOK_API_KEY=shared-secret-key

# External API
API_KEYS=comma,separated,api,keys

# NextAuth
NEXTAUTH_SECRET=random-secret-for-jwt
NEXTAUTH_URL=https://your-monitor-domain.com

# Admin Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=secure-password
```

## Project Structure

```
monitor/
├── app/
│   ├── api/
│   │   ├── v1/              # External API (positions, orders, accounts)
│   │   ├── cron/            # Vercel cron jobs
│   │   ├── monitor/         # Dashboard data endpoint
│   │   └── auth/            # NextAuth routes
│   ├── page.tsx             # Main dashboard UI
│   ├── login/               # Login page
│   └── trade-history/       # Trade history view
├── lib/
│   ├── redis.ts             # Redis client (multi-exchange keys)
│   ├── asterdex.ts          # AsterDex API client
│   ├── okx.ts               # OKX API client
│   ├── backend-cron-client.ts  # Backend-cron wrapper
│   ├── directus.ts          # Directus client
│   └── api-auth.ts          # API key auth
├── components/              # React components
├── docs/                    # Detailed documentation
└── README.md               # This file
```

## Key Endpoints

### Dashboard (Internal)
- `GET /api/monitor` - Fetch all account data
- `POST /api/close-position` - Close position
- `POST /api/cancel-order` - Cancel order
- `POST /api/delete-grid-level` - Delete grid level

### External API (v1)
- `GET /api/v1/accounts` - List trading accounts
- `GET /api/v1/positions` - Get position snapshots
- `GET /api/v1/orders` - Get order snapshots

**Authentication:** Include `x-api-key` header

### Cron Jobs
- `/api/cron/positions-snapshot` - Every 1 minute
- `/api/cron/equity-snapshot` - Every 10 minutes

## Multi-Exchange Support (Phase 2)

### Redis Key Format
```
# Before Phase 2
hypotomuai:asterdex:mmgrid:{accountId}:{symbol}:{SIDE}

# After Phase 2 (dynamic exchange)
hypotomuai:{exchange}:mmgrid:{accountId}:{symbol}:{SIDE}
```

Supported exchanges: `asterdex`, `okx`

### Account Schema (Directus)

| Field | Type | Required | OKX | AsterDex |
|-------|------|----------|-----|----------|
| `id` | UUID | Yes | ✅ | ✅ |
| `name` | String | Yes | ✅ | ✅ |
| `symbol` | String | Yes | `BTC-USDT-SWAP` | `BTCUSDT` |
| `exchange` | String | Yes | `okx` | `asterdex` |
| `api_key` | String | Yes | ✅ | ✅ |
| `api_secret` | String | Yes | ✅ | ✅ |
| `passphrase` | String | OKX only | ✅ | ❌ |
| `status` | String | Yes | `active` | `active` |

**📝 Symbol Format (Auto-Converted)**
- **Directus**: Use AsterDex format (no hyphens): `ETHUSDT`, `BTCUSDT`, `SOLUSDT`
- **Auto-conversion**: The code automatically converts symbols to the correct exchange format:
  - OKX: `ETHUSDT` → `ETH-USDT-SWAP` (adds hyphens and SWAP suffix)
  - AsterDex: Uses symbol as-is (`ETHUSDT`)
- **Note**: You can use either format in Directus, the code will handle conversion

## Deployment

### Vercel (Recommended)

1. **Connect GitHub repo** to Vercel
2. **Set environment variables** in Vercel dashboard
3. **Deploy** - Auto-deploy on push to main
4. **Verify cron jobs** - Check Vercel → Cron

### Cron Jobs Configuration

Defined in `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/positions-snapshot",
      "schedule": "* * * * *"
    },
    {
      "path": "/api/cron/equity-snapshot",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

**Note:** Cron jobs only work in Vercel production environment.

## External API Usage

### Get All Positions
```bash
curl -H "x-api-key: your-api-key" \
  https://your-monitor.vercel.app/api/v1/positions
```

### Get Specific Account
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-monitor.vercel.app/api/v1/positions?accountId=123"
```

### Filter by Exchange
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-monitor.vercel.app/api/v1/positions?exchange=okx"
```

## Development

### Run Tests
```bash
# Currently no test suite
# TODO: Add unit tests and integration tests
```

### Debug Redis
```bash
# Connect to Redis
redis-cli -u $REDIS_URL

# List all keys
KEYS hypotomuai:*

# Get grid levels
GET hypotomuai:okx:mmgrid:account-id:BTC-USDT-SWAP:BUY

# Check latest positions
GET positions:account-id:latest
```

### Debug Directus
```bash
# List all accounts
curl $DIRECTUS_URL/items/trading_accounts \
  -H "Authorization: Bearer $DIRECTUS_TOKEN"
```

## Troubleshooting

### "Missing API credentials" Error
- **Cause:** Account missing `api_key` or `api_secret`
- **Fix:** Update Directus account record

### Grid Levels Not Showing
- **Cause:** Wrong exchange key in Redis or backend-cron not updated
- **Fix:** Verify backend-cron Phase 1 complete, check Redis keys

### Cron Jobs Not Running
- **Cause:** Cron jobs only work in Vercel production
- **Fix:** Deploy to Vercel, check logs in dashboard

### External API Returns 401
- **Cause:** Invalid or missing API key
- **Fix:** Verify `x-api-key` header matches `API_KEYS` env var

## Documentation

### Detailed Guides
- [External API Documentation](./docs/EXTERNAL_API.md)
- [AsterDex Integration Guide](./docs/ASTERDEX_INTEGRATION.md)
- [Cron Jobs Documentation](./docs/CRON_JOBS.md)
- [API Data Fields Reference](./docs/API_DATA_FIELDS.md)

### Project Plans
- [Monitor Overview](../plans/251214-monitor-overview.md)
- [OKX Integration Plan](../plans/251214-okx-integration-plan.md)
- [Phase 2 Completion Report](../plans/reports/251214-phase2-monitor-multi-exchange-complete.md)

### Related Components
- **backend-cron**: Trade execution API proxy
- **ai-trading**: Automated trading strategies
- **frontend**: Account management UI

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Framework | Next.js | 15.5.6 |
| UI Library | React | 19.1.0 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS | 4.x |
| UI Components | Radix UI | Latest |
| Database | Redis | ioredis 5.8.2 |
| CMS | Directus | SDK 20.1.0 |
| Auth | NextAuth.js | 4.24.11 |
| HTTP Client | Axios | 1.12.2 |
| Deployment | Vercel | - |

## Contributing

### Adding New Exchange Support

1. Create client in `lib/{exchange}.ts`
2. Update `lib/redis.ts` to support new exchange key
3. Update API routes to handle new exchange
4. Add exchange to UI badge display
5. Update Directus schema if needed
6. Document in `docs/` folder

### Code Standards

- Use TypeScript strict mode
- Follow Next.js App Router conventions
- Use async/await for API calls
- Handle errors with try/catch
- Add JSDoc comments for complex functions
- Use Tailwind for styling (no CSS modules)

## License

Proprietary - Internal use only

## Support

- **Issues:** Check troubleshooting section above
- **Logs:** Vercel dashboard → Functions → Logs
- **Redis:** Use `redis-cli` for debugging
- **API:** Test with `curl` or Postman

---

**Status:** Production Ready (Phase 2 Complete)
**Last Updated:** 2025-12-14
**Next Phase:** Phase 4 - AI-Trading Multi-Exchange Integration
