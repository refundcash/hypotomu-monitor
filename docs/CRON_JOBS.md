# Cron Jobs Documentation

## Overview

This application uses Vercel Cron Jobs to automatically fetch and store trading data at regular intervals. All data is stored in Redis with automatic TTL (Time To Live) expiration.

## Configured Cron Jobs

### 1. Positions Snapshot (`/api/cron/positions-snapshot`)

**Schedule**: Every 1 minute (`* * * * *`)

**Purpose**: Fetches current positions and pending orders for all active trading accounts and stores them in Redis.

**What it does**:

- Fetches all active accounts from Directus
- For each account (both OKX and Asterdex):
  - Fetches current open positions
  - Fetches pending orders
  - Stores raw data in Redis with 30-day TTL
- Logs success/failure for each account

**Redis Keys Created**:

```
positions:{accountId}:{timestamp}    - Historical position snapshot
positions:{accountId}:latest         - Latest position snapshot
orders:{accountId}:{timestamp}       - Historical orders snapshot
orders:{accountId}:latest            - Latest orders snapshot
```

**Data Structure**:

```typescript
{
  exchange: "asterdex" | "okx",
  symbol: string,
  positions: Array<any>,
  orders: Array<any>,
  raw: any  // Original API response
}
```

### 2. Equity Snapshot (`/api/cron/equity-snapshot`)

**Schedule**: Every 10 minutes (`*/10 * * * *`)

**Purpose**: Stores account equity snapshots for 24-hour comparison.

**Redis Keys Created**:

```
equity:{accountId}:{timestamp}  - Equity value (7-day TTL)
```

## Setup

### 1. Environment Variables

Add these to your `.env.local` and Vercel environment variables:

```bash
# Redis (required for cron jobs)
REDIS_URL="redis://your-redis-url"

# Cron Secret (optional, for manual triggering with auth)
CRON_SECRET="your-random-secret-string"

# Note: Vercel automatically authenticates cron jobs in production
# The CRON_SECRET is only needed if you want to manually trigger
# the endpoints with custom authentication
```

### 2. Vercel Configuration

The cron jobs are configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/positions-snapshot",
      "schedule": "* * * * *" // Every minute
    },
    {
      "path": "/api/cron/equity-snapshot",
      "schedule": "*/10 * * * *" // Every 10 minutes
    }
  ]
}
```

### 3. Deploy to Vercel

Cron jobs only work in production on Vercel. To enable:

1. Push your code to GitHub
2. Deploy to Vercel
3. Add environment variables in Vercel dashboard
4. Cron jobs will automatically start running

## Authentication

The cron endpoints use smart authentication that works automatically:

**In Production (Vercel)**:

- Vercel automatically sends `x-vercel-cron-id` header
- No manual authentication needed
- Cron jobs work out of the box

**For Manual Testing**:

- Development mode: No authentication required
- Production mode: Send `Authorization: Bearer {CRON_SECRET}` header

## Testing Locally

You can manually trigger the cron job endpoint:

```bash
# Local development (no auth needed)
curl http://localhost:3000/api/cron/positions-snapshot

# Manual trigger in production (with auth)
curl -H "Authorization: Bearer your-cron-secret" \
  https://your-app.vercel.app/api/cron/positions-snapshot
```

## Monitoring

### Check Logs

In Vercel dashboard:

1. Go to your project
2. Click "Logs" tab
3. Filter by "Cron" to see cron job executions

### Success Response

```json
{
  "success": true,
  "timestamp": "2025-01-01T00:00:00.000Z",
  "summary": {
    "total": 5,
    "successful": 5,
    "failed": 0
  },
  "results": [
    {
      "accountId": "1",
      "accountName": "Account 1",
      "exchange": "asterdex",
      "positionsCount": 2,
      "ordersCount": 4,
      "success": true
    }
  ]
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

## Using Stored Data

### Get Latest Positions

```typescript
import { getLatestPositions } from "@/lib/redis";

const data = await getLatestPositions(accountId);
// Returns: { timestamp: number, data: {...} }
```

### Get Latest Orders

```typescript
import { getLatestOrders } from "@/lib/redis";

const data = await getLatestOrders(accountId);
// Returns: { timestamp: number, data: {...} }
```

### Get Historical Data

```typescript
import { getPositionsHistory, getOrdersHistory } from "@/lib/redis";

// Get positions from last 24 hours
const endTime = Date.now();
const startTime = endTime - 24 * 60 * 60 * 1000;

const positions = await getPositionsHistory(accountId, startTime, endTime);
const orders = await getOrdersHistory(accountId, startTime, endTime);
// Returns: Array<{ timestamp: number, data: {...} }>
```

## Data Retention

- **Positions & Orders**: 30 days TTL
- **Equity Snapshots**: 7 days TTL
- Data automatically expires after TTL period
- No manual cleanup required

## Troubleshooting

### Cron job not running

1. **Check Vercel logs**: Ensure the cron job is being triggered
2. **Verify environment variables**: REDIS_URL must be set
3. **Check Redis connection**: Ensure Redis is accessible from Vercel

### Missing data in Redis

1. **Check cron job logs**: Look for errors in Vercel dashboard
2. **Verify API credentials**: Ensure account API keys are valid
3. **Test manually**: Trigger the endpoint manually to see errors

### Authentication errors

1. **Development**: CRON_SECRET is optional in development
2. **Production**: Set CRON_SECRET in Vercel environment variables
3. **Headers**: Include `Authorization: Bearer {CRON_SECRET}` header

## Performance Considerations

### 1-Minute Interval Impact

- **API Rate Limits**: Each account makes 2 API calls per minute
- **Redis Storage**: ~1440 snapshots per day per account
- **Storage Size**: Approximately 50-100 KB per snapshot
- **Daily Storage**: ~70-140 MB per account per day (auto-expires after 30 days)

### Optimization Tips

1. **Adjust frequency**: Change to `*/5 * * * *` (every 5 minutes) if needed
2. **Filter accounts**: Only snapshot active accounts
3. **Compress data**: Store only essential fields if storage is limited

## Example Use Cases

### 1. Position Tracking Dashboard

```typescript
// Get latest positions for all accounts
const accounts = ["account-1", "account-2"];
const latestPositions = await Promise.all(
  accounts.map((id) => getLatestPositions(id))
);
```

### 2. Historical Analysis

```typescript
// Get hourly position snapshots for last 24h
const hourlyData = await getPositionsHistory(
  accountId,
  Date.now() - 24 * 60 * 60 * 1000,
  Date.now()
);

// Group by hour for chart
const hourlySnapshots = hourlyData.filter((_, index) => index % 60 === 0);
```

### 3. Alert System

```typescript
// Check if position changed significantly
const latest = await getLatestPositions(accountId);
const previous = await getPositionsHistory(
  accountId,
  Date.now() - 60000, // 1 minute ago
  Date.now()
);

if (latest && previous.length > 0) {
  const positionChange = comparePositions(latest.data, previous[0].data);
  if (positionChange > threshold) {
    sendAlert("Position changed significantly!");
  }
}
```

## Security

### Cron Secret

The `CRON_SECRET` provides basic authentication for cron endpoints:

1. **Development**: Optional (allows testing without auth)
2. **Production**: Recommended to prevent unauthorized access
3. **Vercel**: Automatically adds secret header when calling cron

### Best Practices

1. Use a strong random string for `CRON_SECRET`
2. Keep secret in environment variables, never in code
3. Rotate secret periodically
4. Monitor cron job logs for unauthorized access attempts

## Limits

### Vercel Cron Limits

- **Free Plan**: 1 cron job
- **Pro Plan**: Unlimited cron jobs
- **Minimum interval**: 1 minute
- **Execution timeout**: 10 seconds (Hobby), 60 seconds (Pro)

### Redis Limits

Depends on your Redis provider. Common limits:

- **Upstash Free**: 10,000 commands/day
- **Redis Labs Free**: 30 MB storage
- **Consider**: Paid plan for production use

## Maintenance

### Regular Tasks

1. **Monitor storage**: Check Redis memory usage
2. **Review logs**: Check for recurring errors
3. **Update schedules**: Adjust based on usage patterns
4. **Clean up**: Remove unused account snapshots if needed

### Manual Cleanup

If needed, you can manually clean up old data:

```typescript
import { cleanupOldSnapshots } from "@/lib/redis";

await cleanupOldSnapshots(); // Removes equity snapshots older than 7 days
```

## Support

For issues or questions:

1. Check Vercel cron documentation
2. Review Redis connection logs
3. Test endpoints manually
4. Check application logs in Vercel dashboard
