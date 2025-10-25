# External API Documentation

## Overview

This API provides external access to trading positions and orders data from the trading bot system. All endpoints require API key authentication.

**Base URL**: `https://your-domain.com/api/v1`

## Authentication

All API requests must include an API key in the `x-api-key` header.

```bash
curl -H "x-api-key: your-api-key-here" \
  https://your-domain.com/api/v1/accounts
```

### Getting an API Key

1. Contact the administrator to get an API key
2. Or generate one using the utility function:
   ```typescript
   import { generateApiKey } from "@/lib/api-auth";
   const newKey = generateApiKey();
   ```
3. Add the key to the `API_KEYS` environment variable

### Multiple API Keys

You can configure multiple API keys for different projects:

```bash
API_KEYS="key1-for-project-a,key2-for-project-b,key3-for-project-c"
```

## Endpoints

### 1. Get Accounts

**GET** `/api/v1/accounts`

Get a list of all trading accounts.

**Query Parameters:**
- `exchange` (optional): Filter by exchange (`okx` or `asterdex`)

**Example Request:**
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/accounts?exchange=asterdex"
```

**Example Response:**
```json
{
  "count": 2,
  "accounts": [
    {
      "id": "1",
      "name": "Main Trading Account",
      "symbol": "ETHUSDT",
      "exchange": "asterdex"
    },
    {
      "id": "2",
      "name": "Secondary Account",
      "symbol": "BTCUSDT",
      "exchange": "okx"
    }
  ]
}
```

### 2. Get Positions

**GET** `/api/v1/positions`

Get position data for accounts.

**Query Parameters:**
- `accountId` (optional): Specific account ID
- `startTime` (optional): Start timestamp for historical data (milliseconds)
- `endTime` (optional): End timestamp for historical data (milliseconds)
- `exchange` (optional): Filter by exchange type

**Use Cases:**

#### Get all latest positions
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/positions"
```

**Response:**
```json
{
  "type": "all",
  "count": 2,
  "accounts": [
    {
      "accountId": "1",
      "accountName": "Main Trading Account",
      "symbol": "ETHUSDT",
      "exchange": "asterdex",
      "timestamp": 1761371000000,
      "positions": {
        "exchange": "asterdex",
        "symbol": "ETHUSDT",
        "positions": [
          {
            "symbol": "ETHUSDT",
            "positionAmt": "0.082",
            "entryPrice": "3902.17",
            "markPrice": "3927.60",
            "unRealizedProfit": "2.08",
            "leverage": "20"
          }
        ],
        "raw": {...}
      }
    }
  ]
}
```

#### Get latest position for specific account
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/positions?accountId=1"
```

**Response:**
```json
{
  "accountId": "1",
  "type": "latest",
  "data": {
    "timestamp": 1761371000000,
    "data": {
      "exchange": "asterdex",
      "symbol": "ETHUSDT",
      "positions": [...],
      "raw": {...}
    }
  }
}
```

#### Get historical positions
```bash
# Get positions from last hour
CURRENT=$(date +%s)000
HOUR_AGO=$((CURRENT - 3600000))

curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/positions?accountId=1&startTime=$HOUR_AGO&endTime=$CURRENT"
```

**Response:**
```json
{
  "accountId": "1",
  "type": "historical",
  "count": 60,
  "data": [
    {
      "timestamp": 1761371000000,
      "data": {
        "exchange": "asterdex",
        "symbol": "ETHUSDT",
        "positions": [...],
        "raw": {...}
      }
    },
    {
      "timestamp": 1761371060000,
      "data": {...}
    }
  ]
}
```

#### Filter by exchange
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/positions?exchange=asterdex"
```

### 3. Get Orders

**GET** `/api/v1/orders`

Get orders/trades data for accounts.

**Query Parameters:**
- `accountId` (optional): Specific account ID
- `startTime` (optional): Start timestamp for historical data (milliseconds)
- `endTime` (optional): End timestamp for historical data (milliseconds)
- `exchange` (optional): Filter by exchange type

**Use Cases:**

#### Get all latest orders
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/orders"
```

**Response:**
```json
{
  "type": "all",
  "count": 2,
  "accounts": [
    {
      "accountId": "1",
      "accountName": "Main Trading Account",
      "symbol": "ETHUSDT",
      "exchange": "asterdex",
      "timestamp": 1761371000000,
      "orders": {
        "exchange": "asterdex",
        "symbol": "ETHUSDT",
        "orders": [
          {
            "orderId": 8597249668,
            "symbol": "ETHUSDT",
            "status": "NEW",
            "price": "3874.80",
            "origQty": "0.077",
            "side": "BUY",
            "type": "LIMIT"
          }
        ],
        "raw": {...}
      }
    }
  ]
}
```

#### Get latest orders for specific account
```bash
curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/orders?accountId=1"
```

#### Get historical orders
```bash
# Get orders from last 24 hours
CURRENT=$(date +%s)000
DAY_AGO=$((CURRENT - 86400000))

curl -H "x-api-key: your-api-key" \
  "https://your-domain.com/api/v1/orders?accountId=1&startTime=$DAY_AGO&endTime=$CURRENT"
```

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Valid API key required. Include 'x-api-key' header."
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "Error details..."
}
```

## Rate Limits

- No rate limits currently enforced
- Recommended: Max 60 requests per minute per API key
- Data updates every 1 minute via cron job

## Data Freshness

- **Positions & Orders**: Updated every 1 minute by cron job
- **Historical Data**: Available for up to 30 days
- **Latest Snapshot**: Always reflects most recent data

## Usage Examples

### JavaScript/TypeScript

```typescript
const API_KEY = "your-api-key";
const BASE_URL = "https://your-domain.com/api/v1";

async function getPositions(accountId?: string) {
  const url = accountId
    ? `${BASE_URL}/positions?accountId=${accountId}`
    : `${BASE_URL}/positions`;

  const response = await fetch(url, {
    headers: {
      "x-api-key": API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}

// Get all positions
const allPositions = await getPositions();

// Get specific account
const accountPositions = await getPositions("1");
```

### Python

```python
import requests

API_KEY = "your-api-key"
BASE_URL = "https://your-domain.com/api/v1"

def get_positions(account_id=None):
    url = f"{BASE_URL}/positions"
    if account_id:
        url += f"?accountId={account_id}"

    headers = {"x-api-key": API_KEY}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()

# Get all positions
all_positions = get_positions()

# Get specific account
account_positions = get_positions("1")
```

### cURL

```bash
#!/bin/bash

API_KEY="your-api-key"
BASE_URL="https://your-domain.com/api/v1"

# Get all accounts
curl -H "x-api-key: $API_KEY" \
  "$BASE_URL/accounts"

# Get all positions
curl -H "x-api-key: $API_KEY" \
  "$BASE_URL/positions"

# Get positions for specific account
curl -H "x-api-key: $API_KEY" \
  "$BASE_URL/positions?accountId=1"

# Get historical positions (last hour)
CURRENT=$(date +%s)000
HOUR_AGO=$((CURRENT - 3600000))

curl -H "x-api-key: $API_KEY" \
  "$BASE_URL/positions?accountId=1&startTime=$HOUR_AGO&endTime=$CURRENT"
```

### Advanced: Real-time Monitoring

```typescript
// Poll for updates every minute
const API_KEY = "your-api-key";
const BASE_URL = "https://your-domain.com/api/v1";

async function pollPositions(accountId: string) {
  while (true) {
    try {
      const response = await fetch(
        `${BASE_URL}/positions?accountId=${accountId}`,
        {
          headers: { "x-api-key": API_KEY },
        }
      );

      const data = await response.json();
      console.log("Position update:", data);

      // Check for significant changes
      if (data.data?.data?.positions) {
        const positions = data.data.data.positions;
        positions.forEach((pos: any) => {
          const pnl = parseFloat(pos.unRealizedProfit || 0);
          if (Math.abs(pnl) > 100) {
            console.log(`⚠️ Large PnL detected: $${pnl}`);
          }
        });
      }
    } catch (error) {
      console.error("Error fetching positions:", error);
    }

    // Wait 60 seconds
    await new Promise((resolve) => setTimeout(resolve, 60000));
  }
}

pollPositions("1");
```

## Best Practices

### 1. Cache Responses
```typescript
const cache = new Map();
const CACHE_TTL = 60000; // 1 minute

async function getCachedPositions(accountId: string) {
  const cacheKey = `positions:${accountId}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const data = await getPositions(accountId);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}
```

### 2. Error Handling
```typescript
async function safeGetPositions(accountId: string) {
  try {
    return await getPositions(accountId);
  } catch (error) {
    if (error.message.includes("401")) {
      console.error("Invalid API key");
    } else if (error.message.includes("500")) {
      console.error("Server error, retrying...");
      // Implement retry logic
    }
    throw error;
  }
}
```

### 3. Batch Requests
```typescript
async function getAllAccountsData() {
  // First get account list
  const { accounts } = await fetch(`${BASE_URL}/accounts`, {
    headers: { "x-api-key": API_KEY },
  }).then(r => r.json());

  // Then fetch positions for all accounts in parallel
  const positions = await Promise.all(
    accounts.map(acc => getPositions(acc.id))
  );

  return accounts.map((acc, i) => ({
    ...acc,
    positions: positions[i],
  }));
}
```

## Security

### API Key Management

1. **Never commit API keys** to version control
2. **Use environment variables** for API keys
3. **Rotate keys regularly** (recommended: every 90 days)
4. **Use different keys** for different environments (dev/staging/prod)

### Request Security

1. **Always use HTTPS** in production
2. **Validate response data** before using
3. **Implement request timeouts** (recommended: 30 seconds)
4. **Log API usage** for monitoring

## Support

For API support:
1. Check server logs in Vercel dashboard
2. Verify API key is correct
3. Ensure Redis is accessible
4. Check that cron job is running

## Changelog

### v1.0.0 (Initial Release)
- `/api/v1/accounts` - Get trading accounts
- `/api/v1/positions` - Get positions data
- `/api/v1/orders` - Get orders data
- API key authentication
- Support for historical and latest data
- Exchange filtering
