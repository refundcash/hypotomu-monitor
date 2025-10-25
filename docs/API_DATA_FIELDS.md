# API Data Fields Reference

## Authentication

All API endpoints require authentication using an API key in the request header.

### Header Format
```http
x-api-key: your-api-key-here
```

### Getting an API Key

Contact your administrator or generate using:
```typescript
import { generateApiKey } from "@/lib/api-auth";
const newKey = generateApiKey();
// Returns: 64-character hex string (e.g., "a1b2c3d4e5f6...")
```

### Example Request
```bash
curl -H "x-api-key: your-api-key-here" \
  https://your-domain.com/api/v1/accounts
```

---

## Endpoints Overview

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/api/v1/accounts` | GET | List all trading accounts | Required |
| `/api/v1/positions` | GET | Get position snapshots | Required |
| `/api/v1/orders` | GET | Get order snapshots | Required |

---

## 1. Accounts Endpoint

### GET `/api/v1/accounts`

Returns a list of all trading accounts.

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `exchange` | string | No | Filter by exchange (`okx` or `asterdex`) |

### Response Fields

```typescript
{
  count: number;              // Total number of accounts
  accounts: Array<{
    id: string;              // Account unique ID
    name: string;            // Account display name
    symbol: string;          // Trading pair (e.g., "ETHUSDT", "BTC-USDT-SWAP")
    exchange: string;        // Exchange type ("okx" or "asterdex")
  }>;
}
```

### Example Response

```json
{
  "count": 3,
  "accounts": [
    {
      "id": "1",
      "name": "Main Asterdex Account",
      "symbol": "ETHUSDT",
      "exchange": "asterdex"
    },
    {
      "id": "2",
      "name": "hypotomu-00",
      "symbol": "ETHUSDT",
      "exchange": "asterdex"
    },
    {
      "id": "3",
      "name": "OKX BTC Trading",
      "symbol": "BTC-USDT-SWAP",
      "exchange": "okx"
    }
  ]
}
```

### Total Fields: **4 fields per account**
- `id`
- `name`
- `symbol`
- `exchange`

---

## 2. Positions Endpoint

### GET `/api/v1/positions`

Returns position data from Redis snapshots (updated every 1 minute).

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountId` | string | No | Specific account ID to query |
| `startTime` | number | No | Start timestamp (milliseconds) for historical data |
| `endTime` | number | No | End timestamp (milliseconds) for historical data |
| `exchange` | string | No | Filter by exchange (`okx` or `asterdex`) |

### Response Types

#### Type 1: All Accounts (no accountId specified)

```typescript
{
  type: "all";
  count: number;
  accounts: Array<{
    accountId: string;
    accountName: string;
    symbol: string;
    exchange: string;
    timestamp: number | null;
    positions: PositionData | null;
  }>;
}
```

#### Type 2: Latest Position (accountId specified, no time range)

```typescript
{
  accountId: string;
  type: "latest";
  data: {
    timestamp: number;
    data: PositionData;
  } | null;
}
```

#### Type 3: Historical Positions (accountId + startTime + endTime)

```typescript
{
  accountId: string;
  type: "historical";
  count: number;
  data: Array<{
    timestamp: number;
    data: PositionData;
  }>;
}
```

### Position Data Structure

#### For Asterdex Positions

```typescript
{
  exchange: "asterdex";
  symbol: string;
  positions: Array<{
    symbol: string;              // Trading pair
    positionAmt: string;         // Position amount (+ for long, - for short)
    entryPrice: string;          // Average entry price
    markPrice: string;           // Current mark price
    unRealizedProfit: string;    // Unrealized PnL
    liquidationPrice: string;    // Liquidation price
    leverage: string;            // Leverage multiplier
    maxNotionalValue: string;    // Maximum notional value
    marginType: string;          // "cross" or "isolated"
    isolatedMargin: string;      // Isolated margin amount
    isAutoAddMargin: string;     // Auto-add margin flag
    positionSide: string;        // Position side ("BOTH", "LONG", "SHORT")
    notional: string;            // Notional value in USD
    isolatedWallet: string;      // Isolated wallet balance
    updateTime: number;          // Last update timestamp
  }>;
  raw: any;  // Complete raw API response
}
```

#### For OKX Positions

```typescript
{
  exchange: "okx";
  symbol: string;
  positions: Array<{
    instId: string;              // Instrument ID
    pos: string;                 // Position quantity
    avgPx: string;               // Average price
    upl: string;                 // Unrealized PnL
    uplRatio: string;            // Unrealized PnL ratio
    lever: string;               // Leverage
    notionalUsd: string;         // Notional value in USD
    // ... additional OKX-specific fields
  }>;
  raw: any;  // Complete raw API response
}
```

### Example Response (All Accounts)

```json
{
  "type": "all",
  "count": 2,
  "accounts": [
    {
      "accountId": "2",
      "accountName": "hypotomu-00",
      "symbol": "ETHUSDT",
      "exchange": "asterdex",
      "timestamp": 1761371724296,
      "positions": {
        "exchange": "asterdex",
        "symbol": "ETHUSDT",
        "positions": [
          {
            "symbol": "ETHUSDT",
            "positionAmt": "0.082",
            "entryPrice": "3902.173225807",
            "markPrice": "3927.60861240",
            "unRealizedProfit": "2.08570170",
            "liquidationPrice": "0",
            "leverage": "20",
            "maxNotionalValue": "12000000",
            "marginType": "cross",
            "isolatedMargin": "0.00000000",
            "isAutoAddMargin": "false",
            "positionSide": "BOTH",
            "notional": "322.06390621",
            "isolatedWallet": "0",
            "updateTime": 1761333651183
          }
        ],
        "raw": {...}
      }
    }
  ]
}
```

### Total Fields per Position (Asterdex): **14 fields**
- `symbol`
- `positionAmt`
- `entryPrice`
- `markPrice`
- `unRealizedProfit`
- `liquidationPrice`
- `leverage`
- `maxNotionalValue`
- `marginType`
- `isolatedMargin`
- `isAutoAddMargin`
- `positionSide`
- `notional`
- `isolatedWallet`
- `updateTime`

---

## 3. Orders Endpoint

### GET `/api/v1/orders`

Returns order/trade data from Redis snapshots (updated every 1 minute).

### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `accountId` | string | No | Specific account ID to query |
| `startTime` | number | No | Start timestamp (milliseconds) for historical data |
| `endTime` | number | No | End timestamp (milliseconds) for historical data |
| `exchange` | string | No | Filter by exchange (`okx` or `asterdex`) |

### Response Types

Same structure as positions endpoint:
- **Type 1**: All accounts
- **Type 2**: Latest orders
- **Type 3**: Historical orders

### Order Data Structure

#### For Asterdex Orders

```typescript
{
  exchange: "asterdex";
  symbol: string;
  orders: Array<{
    orderId: number;             // Order ID
    symbol: string;              // Trading pair
    status: string;              // Order status ("NEW", "FILLED", "CANCELED")
    clientOrderId: string;       // Client order ID
    price: string;               // Order price
    avgPrice: string;            // Average filled price
    origQty: string;             // Original quantity
    executedQty: string;         // Executed quantity
    cumQuote: string;            // Cumulative quote asset quantity
    timeInForce: string;         // Time in force ("GTC", "IOC", "FOK")
    type: string;                // Order type ("LIMIT", "MARKET", "STOP")
    reduceOnly: boolean;         // Reduce-only flag
    closePosition: boolean;      // Close position flag
    side: string;                // Order side ("BUY", "SELL")
    positionSide: string;        // Position side
    stopPrice: string;           // Stop price
    workingType: string;         // Working type
    priceProtect: boolean;       // Price protect flag
    origType: string;            // Original order type
    time: number;                // Order creation time
    updateTime: number;          // Last update time
  }>;
  raw: any;  // Complete raw API response
}
```

#### For OKX Orders

```typescript
{
  exchange: "okx";
  symbol: string;
  orders: Array<{
    instId: string;              // Instrument ID
    ordId: string;               // Order ID
    px: string;                  // Price
    sz: string;                  // Size
    side: string;                // Order side ("buy", "sell")
    // ... additional OKX-specific fields
  }>;
  raw: any;  // Complete raw API response
}
```

### Example Response (Specific Account)

```json
{
  "accountId": "2",
  "type": "latest",
  "data": {
    "timestamp": 1761371724296,
    "data": {
      "exchange": "asterdex",
      "symbol": "ETHUSDT",
      "orders": [
        {
          "orderId": 8597249668,
          "symbol": "ETHUSDT",
          "status": "NEW",
          "clientOrderId": "hELaCTK8ry7HXrFdrvf5Ql",
          "price": "3874.80",
          "avgPrice": "0",
          "origQty": "0.077",
          "executedQty": "0",
          "cumQuote": "0",
          "timeInForce": "GTC",
          "type": "LIMIT",
          "reduceOnly": false,
          "closePosition": false,
          "side": "BUY",
          "positionSide": "BOTH",
          "stopPrice": "0",
          "workingType": "CONTRACT_PRICE",
          "priceProtect": false,
          "origType": "LIMIT",
          "time": 1761368995504,
          "updateTime": 1761368995504
        },
        {
          "orderId": 8597249667,
          "symbol": "ETHUSDT",
          "status": "NEW",
          "clientOrderId": "OIIZO1fQqsPxFeB1U1IyKv",
          "price": "3931.10",
          "avgPrice": "0",
          "origQty": "0.076",
          "executedQty": "0",
          "cumQuote": "0",
          "timeInForce": "GTC",
          "type": "LIMIT",
          "reduceOnly": false,
          "closePosition": false,
          "side": "SELL",
          "positionSide": "BOTH",
          "stopPrice": "0",
          "workingType": "CONTRACT_PRICE",
          "priceProtect": false,
          "origType": "LIMIT",
          "time": 1761368995500,
          "updateTime": 1761368995500
        }
      ],
      "raw": {...}
    }
  }
}
```

### Total Fields per Order (Asterdex): **21 fields**
- `orderId`
- `symbol`
- `status`
- `clientOrderId`
- `price`
- `avgPrice`
- `origQty`
- `executedQty`
- `cumQuote`
- `timeInForce`
- `type`
- `reduceOnly`
- `closePosition`
- `side`
- `positionSide`
- `stopPrice`
- `workingType`
- `priceProtect`
- `origType`
- `time`
- `updateTime`

---

## Complete Field Count Summary

### Accounts Endpoint
- **4 fields** per account

### Positions Endpoint (Asterdex)
- **15 fields** per position (including wrapper fields)
- **Raw API response** with all exchange data

### Orders Endpoint (Asterdex)
- **21 fields** per order
- **Raw API response** with all exchange data

### Meta Fields (All Responses)
- `type` - Response type
- `count` - Item count
- `timestamp` - Data timestamp
- `accountId` - Account identifier
- `accountName` - Account name
- `symbol` - Trading symbol
- `exchange` - Exchange type

---

## Data Update Frequency

| Data Type | Update Frequency | Retention Period |
|-----------|-----------------|------------------|
| Positions | Every 1 minute | 30 days |
| Orders | Every 1 minute | 30 days |
| Accounts | Real-time | N/A |

---

## Common Use Cases

### 1. Monitor All Positions

```bash
# Get latest positions for all accounts
curl -H "x-api-key: YOUR_KEY" \
  https://your-domain.com/api/v1/positions
```

**Returns**: All accounts with their latest position snapshots

### 2. Track Specific Account

```bash
# Get latest position for account ID 2
curl -H "x-api-key: YOUR_KEY" \
  https://your-domain.com/api/v1/positions?accountId=2
```

**Returns**: Latest position snapshot for account 2

### 3. Historical Analysis

```bash
# Get positions from last hour
CURRENT=$(date +%s)000
HOUR_AGO=$((CURRENT - 3600000))

curl -H "x-api-key: YOUR_KEY" \
  "https://your-domain.com/api/v1/positions?accountId=2&startTime=$HOUR_AGO&endTime=$CURRENT"
```

**Returns**: Array of position snapshots from the last hour (60 snapshots)

### 4. Exchange Filtering

```bash
# Get all Asterdex positions
curl -H "x-api-key: YOUR_KEY" \
  https://your-domain.com/api/v1/positions?exchange=asterdex
```

**Returns**: Only Asterdex account positions

### 5. Order Book Analysis

```bash
# Get all pending orders
curl -H "x-api-key: YOUR_KEY" \
  https://your-domain.com/api/v1/orders
```

**Returns**: All accounts with their pending orders

---

## Field Type Reference

### String Fields
All price, quantity, and numeric values are returned as **strings** to preserve precision.

### Number Fields
- `timestamp` - milliseconds since epoch
- `updateTime` - milliseconds since epoch
- `time` - milliseconds since epoch
- `count` - integer

### Boolean Fields
- `reduceOnly` - true/false
- `closePosition` - true/false
- `priceProtect` - true/false

### String Booleans (Asterdex)
- `isAutoAddMargin` - "true"/"false" (string)

---

## Error Handling

### Authentication Error (401)

```json
{
  "error": "Unauthorized",
  "message": "Valid API key required. Include 'x-api-key' header."
}
```

### Server Error (500)

```json
{
  "error": "Internal Server Error",
  "message": "Error details..."
}
```

---

## Rate Limiting

- **Current**: No rate limits enforced
- **Recommended**: Max 60 requests per minute
- **Data freshness**: 1-minute granularity

---

## Support

For questions about data fields or API usage:
1. Refer to exchange API documentation (Asterdex, OKX)
2. Check `raw` field in responses for complete data
3. Contact administrator for API key issues
4. Review server logs for debugging

---

## Version History

### v1.0.0
- Initial release with accounts, positions, and orders endpoints
- Support for Asterdex and OKX exchanges
- Historical data queries
- Exchange filtering
