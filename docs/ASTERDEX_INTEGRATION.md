# Asterdex Integration Guide

## Overview

This guide explains how to integrate and use Asterdex accounts in the trading bot system.

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

## How It Works

### 1. Account Detection

The monitor route (`/api/monitor`) automatically detects which exchange to use based on the `exchange` field:

```typescript
const exchange = account.exchange || "okx"; // Defaults to OKX if not specified

if (exchange === "asterdex") {
  // Use Asterdex client
  const asterdex = new AsterdexClient(apiKey, apiSecret, true);
  // Process Asterdex account...
} else {
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

## Migration from OKX

To migrate an existing OKX account to Asterdex:

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
   - Asterdex uses no separators: `BTCUSDT`

3. **Test the integration** using the monitor endpoint

## Future Enhancements

Potential improvements for the Asterdex integration:

1. **WebSocket Support**: Real-time updates for positions and orders
2. **Order Placement UI**: Frontend interface for placing orders
3. **Multi-Exchange Dashboard**: Unified view of all accounts across exchanges
4. **Performance Metrics**: Track and compare performance across exchanges
5. **Automated Trading**: Implement trading strategies that work across both OKX and Asterdex

## Support

For issues related to:

- **Asterdex API**: Refer to [Asterdex API Documentation](https://github.com/asterdex/api-docs)
- **Integration Code**: Check `/lib/asterdex.ts` and `/app/api/monitor/route.ts`
- **Database Schema**: Review your Directus configuration

## References

- [Asterdex API Documentation](/docs/ASTERDEX_API.md)
- [OKX Client Implementation](/lib/okx.ts)
- [Asterdex Client Implementation](/lib/asterdex.ts)
- [Monitor Route](/app/api/monitor/route.ts)
