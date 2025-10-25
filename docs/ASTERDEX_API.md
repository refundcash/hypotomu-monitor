# Asterdex API Documentation

## Overview

Asterdex provides two main trading APIs for cryptocurrency trading:
- **Futures Trading API**: Perpetual futures contracts
- **Spot Trading API**: Spot trading

## Base URLs

- **Futures API**: `https://fapi.asterdex.com`
- **Spot API**: `https://api.asterdex.com`
- **Futures WebSocket**: `wss://fstream.asterdex.com`
- **Spot WebSocket**: `wss://sstream.asterdex.com`

## Authentication

### Futures API (Web3-based Authentication)

The Futures API uses wallet-based authentication with ECDSA signatures.

#### Authentication Parameters
- `user`: Main account wallet address
- `signer`: API wallet address
- `nonce`: Current microseconds timestamp
- Private key for signing

#### Signature Generation Process
1. Generate `nonce` as the current microseconds timestamp
2. Sort parameters by ASCII order
3. ABI encode the JSON string of parameters, `user`, `signer`, and `nonce`
4. Keccak hash the encoded data
5. Sign the hash with the private key using ECDSA

#### Required Headers
- `timestamp`: Millisecond timestamp of request creation
- `recvWindow`: Optional, defaults to 5000ms (max timing variance)

### Spot API (HMAC SHA256 Authentication)

The Spot API uses traditional API key authentication with HMAC SHA256 signatures.

#### Required Headers
- `X-MBX-APIKEY`: Your API key

#### Signature Generation
- Generate HMAC SHA256 signature using `secretKey` as key
- Use `totalParams` (query string + request body) as value
- Include `timestamp` parameter (mandatory)
- Include `recvWindow` parameter (optional, defaults to 5000ms)

## Security Types

Both APIs use the following security types for endpoints:
- `NONE`: Public endpoints, no authentication required
- `MARKET_DATA`: Market data endpoints, requires signature
- `USER_STREAM`: User data stream endpoints, requires signature
- `USER_DATA`: Account data endpoints, requires signature
- `TRADE`: Trading endpoints, requires signature

## Rate Limiting

### Rate Limit Rules
- **REQUEST_WEIGHT**: 2400 requests per minute (IP-based)
- **ORDERS**: 1200 orders per minute (account-based)

### Rate Limit Headers
- `X-MBX-USED-WEIGHT-1M`: Current weight usage in the last minute
- `X-MBX-ORDER-COUNT-1M`: Current order count in the last minute

### Rate Limit Violations
- **HTTP 429**: Too many requests, rate limit exceeded
- **HTTP 418**: IP ban (after multiple 429 violations)

## Common Endpoints

### Public Endpoints (NONE)

#### Test Connectivity
```http
GET /fapi/v1/ping
GET /api/v1/ping
```

#### Server Time
```http
GET /fapi/v1/time
GET /api/v1/time
```

Response:
```json
{
  "serverTime": 1499827319559
}
```

#### Exchange Information
```http
GET /fapi/v1/exchangeInfo
GET /api/v1/exchangeInfo
```

Response fields:
- `exchangeFilters`: Exchange-wide filters
- `rateLimits`: API rate limit information
- `serverTime`: Current server time
- `assets`: Available assets for trading
- `symbols`: Trading pair information
- `timezone`: Server timezone (UTC)

Symbol filters:
- `PRICE_FILTER`: Price rules (minPrice, maxPrice, tickSize)
- `LOT_SIZE`: Quantity rules (minQty, maxQty, stepSize)
- `MARKET_LOT_SIZE`: Market order quantity rules
- `MAX_NUM_ORDERS`: Maximum number of open orders
- `MAX_NUM_ALGO_ORDERS`: Maximum number of algo orders
- `MIN_NOTIONAL`: Minimum notional value
- `PERCENT_PRICE`: Price range percentage limits

## Account Endpoints (USER_DATA)

### Futures Account Information
```http
GET /fapi/v3/account
```

Parameters:
- `timestamp`: Required
- `recvWindow`: Optional (default: 5000)

Response:
```json
{
  "feeTier": 0,
  "canTrade": true,
  "canDeposit": true,
  "canWithdraw": true,
  "updateTime": 0,
  "assets": [
    {
      "asset": "USDT",
      "walletBalance": "122624.12345678",
      "unrealizedProfit": "0.00000000",
      "marginBalance": "122624.12345678",
      "availableBalance": "100.12345678"
    }
  ],
  "positions": [
    {
      "symbol": "BTCUSDT",
      "positionAmt": "1.327",
      "entryPrice": "187.17127",
      "markPrice": "187.17127",
      "unRealizedProfit": "-1.166074",
      "liquidationPrice": "0"
    }
  ]
}
```

### Futures Account Balance
```http
GET /fapi/v3/balance
```

Parameters:
- `timestamp`: Required
- `recvWindow`: Optional

Response:
```json
[
  {
    "accountAlias": "account_name",
    "asset": "USDT",
    "balance": "122624.12345678",
    "availableBalance": "100.12345678",
    "updateTime": 1580895488000
  }
]
```

### Spot Account Information
```http
GET /api/v1/account
```

Parameters:
- `timestamp`: Required (mandatory)
- `recvWindow`: Optional

Response:
```json
{
  "feeTier": 0,
  "canTrade": true,
  "canDeposit": true,
  "canWithdraw": true,
  "updateTime": 123456789,
  "balances": [
    {
      "asset": "BTC",
      "free": "4723846.89208129",
      "locked": "0.00000000"
    }
  ]
}
```

## Trading Endpoints (TRADE)

### Place Order
```http
POST /fapi/v3/order    (Futures)
POST /api/v1/order     (Spot)
```

Parameters:
- `symbol`: Required
- `side`: Required (BUY, SELL)
- `type`: Required (LIMIT, MARKET, STOP, etc.)
- `quantity`: Required
- `price`: Required for LIMIT orders
- `timestamp`: Required
- `recvWindow`: Optional

### Cancel Order
```http
DELETE /fapi/v3/order  (Futures)
DELETE /api/v1/order   (Spot)
```

Parameters:
- `symbol`: Required
- `orderId`: Required
- `timestamp`: Required
- `recvWindow`: Optional

### Query Order
```http
GET /fapi/v3/order     (Futures)
GET /api/v1/order      (Spot)
```

Parameters:
- `symbol`: Required
- `orderId`: Optional
- `startTime`: Optional
- `endTime`: Optional
- `limit`: Optional (default: 500, max: 1000)
- `timestamp`: Required

### Account Trades
```http
GET /fapi/v3/userTrades  (Futures)
GET /api/v1/userTrades   (Spot)
```

Response:
```json
[
  {
    "symbol": "BTCUSDT",
    "id": 28457,
    "orderId": 100234,
    "side": "BUY",
    "price": "4.00000100",
    "qty": "12.00000000",
    "commission": "10.10000000",
    "commissionAsset": "BNB",
    "time": 1499865549590
  }
]
```

## WebSocket Streams

### Connection Information
- Futures: `wss://fstream.asterdex.com`
- Spot: `wss://sstream.asterdex.com`
- Connection valid for 24 hours
- Server ping interval: 5 minutes (Futures), 3 minutes (Spot)
- Pong timeout: 15 minutes (Futures), 10 minutes (Spot)
- Rate limit: 10 incoming messages per second

### Market Data Streams

#### Aggregate Trade Stream
```
wss://fstream.asterdex.com/ws/<symbol>@aggTrade
```

Payload:
```json
{
  "e": "aggTrade",
  "E": 123456789,
  "s": "BTCUSDT",
  "a": 5933014,
  "p": "0.001",
  "q": "100",
  "f": 100,
  "l": 105,
  "T": 123456785,
  "m": true
}
```

#### Mark Price Stream
```
wss://fstream.asterdex.com/ws/<symbol>@markPrice
wss://fstream.asterdex.com/ws/<symbol>@markPrice@1s
```

Payload:
```json
{
  "e": "markPriceUpdate",
  "E": 1562305380000,
  "s": "BTCUSDT",
  "p": "11794.15000000",
  "i": "11784.62659091",
  "P": "11784.25641265",
  "r": "0.00038167",
  "T": 1562306400000
}
```

#### Kline/Candlestick Stream
```
wss://fstream.asterdex.com/ws/<symbol>@kline_<interval>
```

Intervals: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M

Payload:
```json
{
  "e": "kline",
  "E": 123456789,
  "s": "BTCUSDT",
  "k": {
    "t": 123400000,
    "T": 123460000,
    "s": "BTCUSDT",
    "i": "1m",
    "f": 100,
    "L": 200,
    "o": "0.0010",
    "c": "0.0020",
    "h": "0.0025",
    "l": "0.0015",
    "v": "1000",
    "n": 100,
    "x": false,
    "q": "1.0000",
    "V": "500",
    "Q": "0.500",
    "B": "123456"
  }
}
```

#### Order Book Depth Stream
```
wss://fstream.asterdex.com/ws/<symbol>@depth
wss://fstream.asterdex.com/ws/<symbol>@depth@100ms
wss://fstream.asterdex.com/ws/<symbol>@depth@500ms
```

Payload:
```json
{
  "e": "depthUpdate",
  "E": 123456789,
  "T": 123456788,
  "s": "BTCUSDT",
  "U": 157,
  "u": 160,
  "pu": 149,
  "b": [
    ["0.0024", "10"]
  ],
  "a": [
    ["0.0026", "100"]
  ]
}
```

#### Book Ticker Stream
```
wss://fstream.asterdex.com/ws/<symbol>@bookTicker
wss://fstream.asterdex.com/ws/!bookTicker  (all symbols)
```

Payload:
```json
{
  "e": "bookTicker",
  "u": 157,
  "E": 1568014460893,
  "T": 1568014460893,
  "s": "BTCUSDT",
  "b": "25.30000000",
  "B": "31.21000000",
  "a": "25.36520000",
  "A": "40.66000000"
}
```

### User Data Streams

#### Start User Data Stream
```http
POST /fapi/v1/listenKey  (Futures)
POST /api/v1/listenKey   (Spot)
```

Response:
```json
{
  "listenKey": "pqia91ma19a5s61cv6a81va65sdf19v8a65a1a5s61cv6a81va65sdf19v8a65a1"
}
```

#### Connect to Stream
```
wss://fstream.asterdex.com/ws/<listenKey>
```

#### Keepalive Stream (extend 60 minutes)
```http
PUT /fapi/v1/listenKey  (Futures)
PUT /api/v1/listenKey   (Spot)
```

#### Close Stream
```http
DELETE /fapi/v1/listenKey  (Futures)
DELETE /api/v1/listenKey   (Spot)
```

#### Listen Key Expired Event
```json
{
  "e": "listenKeyExpired",
  "E": 1576653824250
}
```

#### Margin Call Event
```json
{
  "e": "MARGIN_CALL",
  "E": 1587727187525,
  "cw": "3.16812045",
  "p": [
    {
      "s": "ETHUSDT",
      "ps": "LONG",
      "pa": "1.327",
      "mt": "CROSSED",
      "iw": "0",
      "mp": "187.17127",
      "up": "-1.166074",
      "mm": "1.614445"
    }
  ]
}
```

#### Account Update Event
```json
{
  "e": "ACCOUNT_UPDATE",
  "E": 1564745798939,
  "T": 1564745798938,
  "a": {
    "m": "ORDER",
    "B": [
      {
        "a": "USDT",
        "wb": "122624.12345678",
        "cw": "100.12345678"
      }
    ]
  }
}
```

## Error Codes

### HTTP Error Codes
- `400`: Bad Request - Invalid parameters
- `401`: Unauthorized - Invalid API key
- `403`: Forbidden - Access denied
- `404`: Not Found - Endpoint not found
- `418`: IP Auto-Ban - IP has been auto-banned
- `429`: Rate Limit - Too many requests
- `500`: Internal Server Error - Server error
- `503`: Service Unavailable - Service temporarily unavailable

### API Error Codes
- `-1000`: Unknown error
- `-1001`: Disconnected
- `-1002`: Unauthorized
- `-1003`: Too many requests
- `-1004`: Duplicate IP blocked
- `-1006`: Unexpected response
- `-1007`: Timeout
- `-1014`: Unknown order composition
- `-1015`: Too many orders
- `-1016`: Service shutting down
- `-1020`: Unsupported operation
- `-1021`: Invalid timestamp
- `-1022`: Invalid signature

## Best Practices

### Timing Security
- Synchronize your system time with NTP servers
- Use `recvWindow` parameter to handle network latency (max 60000ms)
- Server rejects requests with `timestamp` > server time + 1000ms

### Connection Management
- Implement exponential backoff for reconnection
- Handle WebSocket ping/pong frames
- Refresh `listenKey` every 30 minutes for user data streams
- Monitor connection health and reconnect as needed

### Order Management
- Always check order status after placement
- Use `clientOrderId` for idempotent order placement
- Implement proper error handling for rate limits
- Cache exchange info to reduce API calls

### Data Handling
- Validate all data against exchange filters before submission
- Round prices and quantities according to instrument precision
- Handle different precision for different trading pairs
- Calculate notional value for MIN_NOTIONAL filter validation

## Implementation Notes

### Account Field Detection
In your database, accounts have an `exchange` field to identify which exchange they belong to:
- Check `exchange === "asterdex"` to route API calls to Asterdex
- Store API credentials in account fields:
  - For Futures: `wallet_address`, `api_wallet_address`, `private_key`
  - For Spot: `api_key`, `api_secret`

### Integration with Existing Codebase
1. Create an `AsterdexClient` class similar to `OKXClient`
2. Update monitor route to check account's `exchange` field
3. Instantiate appropriate client based on exchange value
4. Map Asterdex response format to common interface

## References

- [Asterdex API Documentation](https://github.com/asterdex/api-docs)
- [Futures Trading API](https://github.com/asterdex/api-docs/blob/master/aster-finance-futures-api-v3.md)
- [Spot Trading API](https://github.com/asterdex/api-docs/blob/master/aster-finance-spot-api.md)
