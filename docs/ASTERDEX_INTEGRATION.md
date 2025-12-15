# Multi-Exchange Integration Guide (AsterDex + OKX)

**Updated:** 2025-12-14 (Phase 2 Complete)

## Overview

This guide explains how to integrate and use both AsterDex and OKX accounts in the trading bot system with full multi-exchange support implemented in Phase 2.

## Database Schema

### Account Fields

In your Directus `trading_accounts` collection, accounts should have the following fields:

| Field        | Type   | Required | Description                              |
| ------------ | ------ | -------- | ---------------------------------------- |
| `id`         | UUID   | Yes      | Unique account identifier                |
| `name`       | String | Yes      | Account display name                     |
| `symbol`     | String | Yes      | Trading pair symbol (e.g., "BTCUSDT")    |
| `exchange`   | String | Yes      | Exchange identifier: "okx" or "asterdex" |
| `api_key`    | String | Yes      | API Key for authentication               |
| `api_secret` | String | Yes      | API Secret for signing requests          |
| `passphrase` | String | No       | Required for OKX, not used for Asterdex  |
| `status`     | String | Yes      | "active" for active accounts             |

### Example Account Records

#### Asterdex Account

```json
{
  "id": "uuid-here",
  "name": "Asterdex BTC Account",
  "symbol": "BTCUSDT",
  "exchange": "asterdex",
  "api_key": "your-asterdex-api-key",
  "api_secret": "your-asterdex-api-secret",
  "status": "active"
}
```

#### OKX Account

```json
{
  "id": "uuid-here",
  "name": "OKX ETH Account",
  "symbol": "ETH-USDT-SWAP",
  "exchange": "okx",
  "api_key": "your-okx-api-key",
  "api_secret": "your-okx-api-secret",
  "passphrase": "your-okx-passphrase",
  "status": "active"
}
```

## Phase 2: Multi-Exchange Support

### What's New in Phase 2

✅ **Dynamic Exchange Keys in Redis** - All Redis operations now accept exchange parameter
✅ **Multi-Exchange Grid Levels** - Grid levels stored per exchange
✅ **Exchange-Aware API Routes** - All API routes handle both AsterDex and OKX
✅ **Backward Compatible** - Existing AsterDex-only setups continue to work

### Redis Key Changes

**Before Phase 2:**
```
hypotomuai:asterdex:mmgrid:{accountId}:{symbol}:BUY
hypotomuai:asterdex:price:BTCUSDT
```

**After Phase 2:**
```
hypotomuai:{exchange}:mmgrid:{accountId}:{symbol}:BUY
hypotomuai:{exchange}:price:{symbol}

# Examples:
hypotomuai:asterdex:mmgrid:123:BTCUSDT:BUY
hypotomuai:okx:mmgrid:456:BTC-USDT-SWAP:SELL
```

## How It Works

### 1. Account Detection

The monitor route (`/api/monitor`) automatically detects which exchange to use based on the `exchange` field:

```typescript
const exchange = account.exchange || "asterdex"; // Defaults to AsterDex for backward compatibility

if (exchange === "asterdex") {
  // Use Asterdex client
  const asterdex = new AsterdexClient(apiKey, apiSecret, true);
  // Process Asterdex account...
} else if (exchange === "okx") {
  // Use OKX client
  const okx = new OKXClient(apiKey, apiSecret, passphrase);
  // Process OKX account...
}
```

### 2. API Client Initialization

#### Asterdex Client

```typescript
import { AsterdexClient } from "@/lib/asterdex";

const asterdex = new AsterdexClient(
  apiKey, // Your Asterdex API Key
  apiSecret, // Your Asterdex API Secret
  true // true for Futures API, false for Spot API
);
```

#### OKX Client

```typescript
import { OKXClient } from "@/lib/okx";

const okx = new OKXClient(
  apiKey, // Your OKX API Key
  apiSecret, // Your OKX API Secret
  passphrase // Your OKX passphrase
);
```

### 3. Data Retrieval

Both clients provide similar methods for retrieving account data:

```typescript
// Get account balance
const balance = await client.getAccountBalance();

// Get positions
const positions = await client.getPositions(symbol);

// Get pending orders
const orders = await client.getPendingOrders(symbol);

// Get ticker/current price
const ticker = await client.getTicker(symbol);
```

### 4. Response Normalization

The `processAsterdexAccount` function normalizes Asterdex API responses to match the format used by OKX accounts, ensuring consistent data structure across exchanges:

```typescript
{
  accountId: string;
  accountName: string;
  symbol: string;
  exchange: "asterdex" | "okx";
  currentPrice: number | null;
  balance: {
    equity: number;
    availableBalance: number;
    balanceInUse: number;
    unrealizedPnL: number;
    equity24hAgo: number | null;
    equity24hChange: number | null;
    equity24hChangePercent: number | null;
  }
  positions: Array<{
    side: "LONG" | "SHORT";
    contracts: number;
    avgPrice: number;
    unrealizedPnL: number;
    unrealizedPnLRatio: number;
    leverage: number;
    notionalUsd: number;
    instId: string;
  }>;
  buyOrders: Array<{
    price: number;
    size: number;
    value: number;
    orderId: string;
    instId: string;
  }>;
  sellOrders: Array<{
    price: number;
    size: number;
    value: number;
    orderId: string;
    instId: string;
  }>;
}
```

## API Methods

### AsterdexClient

#### Constructor

```typescript
new AsterdexClient(apiKey: string, apiSecret: string, isFutures: boolean = true)
```

#### Methods

##### getAccountBalance()

```typescript
async getAccountBalance(): Promise<any>
```

Returns account balance information for USDT and other assets.

**Response Format:**

```json
[
  {
    "asset": "USDT",
    "balance": "122624.12345678",
    "availableBalance": "100.12345678"
  }
]
```

##### getAccount()

```typescript
async getAccount(): Promise<any>
```

Returns full account information including assets and positions.

##### getPositions(symbol?)

```typescript
async getPositions(symbol?: string): Promise<any>
```

Returns position information for a specific symbol or all symbols.

**Response Format:**

```json
[
  {
    "symbol": "BTCUSDT",
    "positionAmt": "1.327",
    "entryPrice": "187.17127",
    "unRealizedProfit": "-1.166074",
    "leverage": "10"
  }
]
```

##### getPendingOrders(symbol?)

```typescript
async getPendingOrders(symbol?: string): Promise<any>
```

Returns pending orders for a specific symbol or all symbols.

**Response Format:**

```json
[
  {
    "symbol": "BTCUSDT",
    "orderId": "123456",
    "side": "BUY",
    "price": "50000.00",
    "origQty": "0.1"
  }
]
```

##### getTicker(symbol)

```typescript
async getTicker(symbol: string): Promise<any>
```

Returns 24-hour ticker information for a symbol.

**Response Format:**

```json
{
  "symbol": "BTCUSDT",
  "lastPrice": "50123.45",
  "bidPrice": "50120.00",
  "askPrice": "50125.00",
  "volume": "1234.56"
}
```

##### placeOrder(orderData)

```typescript
async placeOrder(orderData: OrderData): Promise<any>

interface OrderData {
  symbol: string;
  side: string;        // "BUY" or "SELL"
  type?: string;       // "LIMIT", "MARKET", etc.
  quantity?: string;
  price?: string;
  timeInForce?: string;
}
```

Places a new order on Asterdex.

##### cancelOrder(symbol, orderId)

```typescript
async cancelOrder(symbol: string, orderId: string): Promise<any>
```

Cancels an existing order.

##### getExchangeInfo(symbol?)

```typescript
async getExchangeInfo(symbol?: string): Promise<any>
```

Returns exchange trading rules and symbol information.

## Testing

### Manual Testing

To test the Asterdex integration:

1. **Add an Asterdex account** to your Directus `trading_accounts` collection:

   - Set `exchange` to `"asterdex"`
   - Provide valid `api_key` and `api_secret`
   - Set `status` to `"active"`

2. **Call the monitor endpoint**:

   ```bash
   curl -X GET http://localhost:3000/api/monitor \
     -H "Authorization: Bearer YOUR_AUTH_TOKEN"
   ```

3. **Verify the response** includes your Asterdex account with:
   - `exchange: "asterdex"`
   - Balance information
   - Positions (if any)
   - Orders (if any)

### Error Handling

The integration includes comprehensive error handling:

- **Missing credentials**: Returns error message indicating which credentials are missing
- **API errors**: Catches and logs errors, returns error message in response
- **Network errors**: Axios handles timeouts and connection errors
- **Data format errors**: Flexible field mapping handles different response formats

## Troubleshooting

### Common Issues

#### 1. "Missing API credentials" Error

**Cause**: `api_key` or `api_secret` not set in account record.
**Solution**: Ensure both fields are populated in Directus.

#### 2. Authentication Failed

**Cause**: Invalid API key or secret, or incorrect signature.
**Solution**:

- Verify API credentials are correct
- Check that you're using the correct Asterdex API (Futures vs Spot)
- Ensure API key has necessary permissions

#### 3. Symbol Format Issues

**Cause**: Different exchanges use different symbol formats.
**Solution**:

- OKX: `ETH-USDT-SWAP`
- Asterdex: `ETHUSDT`

#### 4. Rate Limiting

**Cause**: Too many API requests.
**Solution**: Asterdex allows 2400 requests/minute. Monitor `X-MBX-USED-WEIGHT-1M` header.

### Debug Mode

To enable detailed logging, add console.log statements in the `processAsterdexAccount` function:

```typescript
console.log("Asterdex Response - Balance:", balanceResponse);
console.log("Asterdex Response - Positions:", positionsResponse);
console.log("Asterdex Response - Orders:", ordersResponse);
```

## Phase 2 API Changes

### Redis Client (`lib/redis.ts`)

All Redis functions now accept an `exchange` parameter:

```typescript
// Grid Level Functions (with exchange)
getGridLevels(accountId, symbol, exchange = "asterdex")
setGridLevel(accountId, symbol, side, level, exchange = "asterdex")
clearGridLevels(accountId, symbol, exchange = "asterdex")
deleteGridLevel(accountId, symbol, side, level, exchange = "asterdex")
batchGetGridLevels(accountId, symbol, exchange = "asterdex")
getGridLevelsBothSides(accountId, symbol, exchange = "asterdex")

// State & Price Functions (with exchange)
setAccountState(accountId, symbol, state, exchange = "asterdex")
getAccountState(accountId, symbol, exchange = "asterdex")
setMarketPrice(exchange, symbol, price)
getMarketPrice(exchange, symbol)
```

**Backward Compatibility:** All functions default to `exchange = "asterdex"` if not specified.

### API Route Updates

**`app/api/monitor/route.ts`**
```typescript
// Now passes exchange to Redis
const gridLevels = await getGridLevelsBothSides(
  account.id,
  account.symbol,
  account.exchange || "asterdex"
);
```

**`app/api/positions/route.ts`**
```typescript
// OKX positions
const gridLevels = await getGridLevelsBothSides(
  accountId,
  symbol,
  "okx"
);

// AsterDex positions
const gridLevels = await getGridLevelsBothSides(
  accountId,
  symbol,
  "asterdex"
);
```

**`app/api/delete-grid-level/route.ts`**
```typescript
// Accepts exchange from request body
const { accountId, symbol, side, level, exchange } = await request.json();
const exchangeName = exchange || "asterdex"; // Backward compatible

await deleteGridLevel(accountId, symbol, side, level, exchangeName);
```

## Migration Guide

### From OKX-Only to AsterDex

To migrate an existing OKX account to AsterDex:

1. **Update the account record** in Directus:

   ```sql
   UPDATE trading_accounts
   SET exchange = 'asterdex',
       api_key = 'new-asterdex-api-key',
       api_secret = 'new-asterdex-api-secret',
       passphrase = NULL
   WHERE id = 'account-uuid';
   ```

2. **Update symbol format** if needed:

   - OKX uses dashes: `BTC-USDT-SWAP`
   - AsterDex uses no separators: `BTCUSDT`

3. **Clear old Redis grid levels:**

   ```bash
   redis-cli -u $REDIS_URL DEL hypotomuai:okx:mmgrid:account-id:BTC-USDT-SWAP:BUY
   redis-cli -u $REDIS_URL DEL hypotomuai:okx:mmgrid:account-id:BTC-USDT-SWAP:SELL
   ```

4. **Test the integration** using the monitor endpoint

### From Single Exchange to Multi-Exchange

If migrating from pre-Phase 2 (AsterDex-only):

1. **No code changes needed** - Phase 2 is backward compatible
2. **Add OKX accounts** to Directus with `exchange = "okx"`
3. **Deploy monitor updates** (Phase 2 changes)
4. **Verify Redis keys** use dynamic exchange prefix

## Testing Multi-Exchange Setup

### 1. Create Test Accounts in Directus

**AsterDex Account:**
```json
{
  "name": "AsterDex BTC Test",
  "symbol": "BTCUSDT",
  "exchange": "asterdex",
  "api_key": "your-asterdex-key",
  "api_secret": "your-asterdex-secret",
  "status": "active"
}
```

**OKX Account:**
```json
{
  "name": "OKX BTC Test",
  "symbol": "BTC-USDT-SWAP",
  "exchange": "okx",
  "api_key": "your-okx-key",
  "api_secret": "your-okx-secret",
  "passphrase": "your-okx-passphrase",
  "status": "active"
}
```

### 2. Run Positions Snapshot

```bash
curl -X POST http://localhost:3000/api/cron/positions-snapshot
```

### 3. Verify Redis Keys

```bash
# Check AsterDex grid levels
redis-cli -u $REDIS_URL GET hypotomuai:asterdex:mmgrid:account-id:BTCUSDT:BUY

# Check OKX grid levels
redis-cli -u $REDIS_URL GET hypotomuai:okx:mmgrid:account-id:BTC-USDT-SWAP:BUY

# List all grid keys
redis-cli -u $REDIS_URL KEYS hypotomuai:*:mmgrid:*
```

### 4. Test Dashboard UI

1. Open http://localhost:3000
2. Login with admin credentials
3. Verify both accounts appear with exchange badges:
   - AsterDex account shows "Asterdex" badge
   - OKX account shows "OKX" badge
4. Check grid levels display correctly for both exchanges
5. Test close position for both exchanges
6. Test delete grid level for both exchanges

## Future Enhancements

Potential improvements for the multi-exchange integration:

1. ✅ **Multi-Exchange Dashboard**: Unified view of all accounts across exchanges (Phase 2 ✅)
2. **WebSocket Support**: Real-time updates for positions and orders
3. **Order Placement UI**: Frontend interface for placing orders
4. **Performance Metrics**: Track and compare performance across exchanges
5. **Automated Trading**: Implement trading strategies that work across both OKX and AsterDex
6. **Exchange Arbitrage**: Detect and alert on price differences
7. **Unified Symbol Normalization**: Auto-convert between exchange symbol formats

## Phase 2 Implementation Details

### Files Modified

1. **`lib/redis.ts`** - All Redis functions accept exchange parameter (9 functions updated)
2. **`app/api/monitor/route.ts`** - Passes exchange to grid level functions (line 158)
3. **`app/api/positions/route.ts`** - Exchange-specific processing (lines 96, 224)
4. **`app/api/delete-grid-level/route.ts`** - Exchange parameter handling (lines 15, 29, 31, 47)

### Backward Compatibility

All changes are backward compatible:
- Default `exchange = "asterdex"` for all Redis functions
- Existing API calls without exchange param continue to work
- Pre-Phase 2 AsterDex-only setups unaffected
- No breaking changes to external API contracts

### Prerequisites for Full Functionality

Before testing multi-exchange:
1. ✅ Backend-cron Phase 1 complete (OKX client + ExchangeClient abstraction)
2. ✅ Directus has `exchange` field in `trading_accounts` collection
3. ✅ Redis accessible from monitor application
4. ✅ Monitor Phase 2 deployed

## Support

For issues related to:

- **Multi-Exchange Support**: Check Phase 2 completion report in `../plans/reports/`
- **AsterDex API**: Refer to [AsterDex API Documentation](https://github.com/asterdex/api-docs)
- **OKX API**: Refer to [OKX API Documentation](https://www.okx.com/docs-v5/en/)
- **Integration Code**: Check `/lib/asterdex.ts`, `/lib/okx.ts`, `/app/api/monitor/route.ts`
- **Database Schema**: Review your Directus configuration
- **Redis Keys**: Use `redis-cli` to inspect key structure

## References

### Documentation
- [Monitor Overview](../plans/251214-monitor-overview.md)
- [Phase 2 Completion Report](../plans/reports/251214-phase2-monitor-multi-exchange-complete.md)
- [OKX Integration Plan](../plans/251214-okx-integration-plan.md)
- [AsterDex API Documentation](./ASTERDEX_API.md)
- [External API Documentation](./EXTERNAL_API.md)

### Code Files
- [OKX Client Implementation](../lib/okx.ts)
- [AsterDex Client Implementation](../lib/asterdex.ts)
- [Redis Client (Multi-Exchange)](../lib/redis.ts)
- [Monitor Route](../app/api/monitor/route.ts)
- [Positions Route](../app/api/positions/route.ts)
