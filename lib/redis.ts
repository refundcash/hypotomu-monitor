import Redis from "ioredis";

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL environment variable is not set");
    }
    redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });
  }
  return redis;
}

/**
 * Store equity snapshot for an account
 * Key format: hypotom-monitor:equity:{accountId}:{timestamp}
 */
export async function storeEquitySnapshot(
  accountId: string,
  equity: number
): Promise<void> {
  const client = getRedisClient();
  const timestamp = Date.now();
  const key = `hypotom-monitor:equity:${accountId}:${timestamp}`;

  // Store with 7 days TTL (in seconds)
  await client.setex(key, 7 * 24 * 60 * 60, equity.toString());
}

/**
 * Get equity snapshot from 24 hours ago
 * Returns the closest snapshot to 24h ago (within a 1-hour window)
 */
export async function getEquity24hAgo(
  accountId: string
): Promise<number | null> {
  const client = getRedisClient();
  const now = Date.now();
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

  // Search window: 23-25 hours ago
  const searchStart = twentyFourHoursAgo - 60 * 60 * 1000; // 25h ago
  const searchEnd = twentyFourHoursAgo + 60 * 60 * 1000; // 23h ago

  // Get all keys matching the pattern
  const pattern = `hypotom-monitor:equity:${accountId}:*`;
  const keys = await client.keys(pattern);

  if (keys.length === 0) {
    return null;
  }

  // Find the key closest to 24h ago
  let closestKey: string | null = null;
  let closestDiff = Infinity;

  for (const key of keys) {
    const parts = key.split(":");
    const timestamp = parseInt(parts[3]); // Updated index after adding prefix

    if (timestamp >= searchStart && timestamp <= searchEnd) {
      const diff = Math.abs(timestamp - twentyFourHoursAgo);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestKey = key;
      }
    }
  }

  if (!closestKey) {
    return null;
  }

  const value = await client.get(closestKey);
  return value ? parseFloat(value) : null;
}

/**
 * Clean up old equity snapshots (older than 7 days)
 * This is optional as we're using TTL, but can be used for manual cleanup
 */
export async function cleanupOldSnapshots(): Promise<void> {
  const client = getRedisClient();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  const pattern = `hypotom-monitor:equity:*`;
  const keys = await client.keys(pattern);

  const deletePromises = keys
    .filter((key) => {
      const parts = key.split(":");
      const timestamp = parseInt(parts[3]); // Updated index after adding prefix
      return timestamp < sevenDaysAgo;
    })
    .map((key) => client.del(key));

  await Promise.all(deletePromises);
}

/**
 * Store positions snapshot for an account
 * Key format: hypotom-monitor:positions:{accountId}:{timestamp}
 */
export async function storePositionsSnapshot(
  accountId: string,
  positions: any
): Promise<void> {
  const client = getRedisClient();
  const timestamp = Date.now();
  const key = `hypotom-monitor:positions:${accountId}:${timestamp}`;

  // Store with 30 days TTL (in seconds)
  await client.setex(key, 30 * 24 * 60 * 60, JSON.stringify(positions));

  // Also store the latest snapshot with a fixed key
  const latestKey = `hypotom-monitor:positions:${accountId}:latest`;
  await client.setex(
    latestKey,
    30 * 24 * 60 * 60,
    JSON.stringify({
      timestamp,
      data: positions,
    })
  );
}

/**
 * Store orders/trades snapshot for an account
 * Key format: hypotom-monitor:orders:{accountId}:{timestamp}
 */
export async function storeOrdersSnapshot(
  accountId: string,
  orders: any
): Promise<void> {
  const client = getRedisClient();
  const timestamp = Date.now();
  const key = `hypotom-monitor:orders:${accountId}:${timestamp}`;

  // Store with 30 days TTL (in seconds)
  await client.setex(key, 30 * 24 * 60 * 60, JSON.stringify(orders));

  // Also store the latest snapshot with a fixed key
  const latestKey = `hypotom-monitor:orders:${accountId}:latest`;
  await client.setex(
    latestKey,
    30 * 24 * 60 * 60,
    JSON.stringify({
      timestamp,
      data: orders,
    })
  );
}

/**
 * Get latest positions snapshot for an account
 */
export async function getLatestPositions(
  accountId: string
): Promise<{ timestamp: number; data: any } | null> {
  const client = getRedisClient();
  const key = `hypotom-monitor:positions:${accountId}:latest`;
  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}

/**
 * Get latest orders snapshot for an account
 */
export async function getLatestOrders(
  accountId: string
): Promise<{ timestamp: number; data: any } | null> {
  const client = getRedisClient();
  const key = `hypotom-monitor:orders:${accountId}:latest`;
  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}

/**
 * Get positions history for an account within a time range
 */
export async function getPositionsHistory(
  accountId: string,
  startTime: number,
  endTime: number
): Promise<Array<{ timestamp: number; data: any }>> {
  const client = getRedisClient();
  const pattern = `hypotom-monitor:positions:${accountId}:*`;
  const keys = await client.keys(pattern);

  const results = [];
  for (const key of keys) {
    if (key.endsWith(":latest")) continue; // Skip the latest key

    const parts = key.split(":");
    const timestamp = parseInt(parts[3]); // Updated index after adding prefix

    if (timestamp >= startTime && timestamp <= endTime) {
      const value = await client.get(key);
      if (value) {
        results.push({
          timestamp,
          data: JSON.parse(value),
        });
      }
    }
  }

  return results.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get orders history for an account within a time range
 */
export async function getOrdersHistory(
  accountId: string,
  startTime: number,
  endTime: number
): Promise<Array<{ timestamp: number; data: any }>> {
  const client = getRedisClient();
  const pattern = `hypotom-monitor:orders:${accountId}:*`;
  const keys = await client.keys(pattern);

  const results = [];
  for (const key of keys) {
    if (key.endsWith(":latest")) continue; // Skip the latest key

    const parts = key.split(":");
    const timestamp = parseInt(parts[3]); // Updated index after adding prefix

    if (timestamp >= startTime && timestamp <= endTime) {
      const value = await client.get(key);
      if (value) {
        results.push({
          timestamp,
          data: JSON.parse(value),
        });
      }
    }
  }

  return results.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Store trade history snapshot for an account
 * Key format: hypotom-monitor:trades:{accountId}:{timestamp}
 */
export async function storeTradeHistorySnapshot(
  accountId: string,
  tradeHistory: any
): Promise<void> {
  const client = getRedisClient();
  const timestamp = Date.now();
  const key = `hypotom-monitor:trades:${accountId}:${timestamp}`;

  // Store forever (no TTL)
  await client.set(key, JSON.stringify(tradeHistory));

  // Also store the latest snapshot with a fixed key (no TTL)
  const latestKey = `hypotom-monitor:trades:${accountId}:latest`;
  await client.set(
    latestKey,
    JSON.stringify({
      timestamp,
      data: tradeHistory,
    })
  );
}

/**
 * Get latest trade history snapshot for an account
 */
export async function getLatestTradeHistory(
  accountId: string
): Promise<{ timestamp: number; data: any } | null> {
  const client = getRedisClient();
  const key = `hypotom-monitor:trades:${accountId}:latest`;
  const value = await client.get(key);
  return value ? JSON.parse(value) : null;
}

/**
 * Get trade history for an account within a time range
 */
export async function getTradeHistoryRange(
  accountId: string,
  startTime: number,
  endTime: number
): Promise<Array<{ timestamp: number; data: any }>> {
  const client = getRedisClient();
  const pattern = `hypotom-monitor:trades:${accountId}:*`;
  const keys = await client.keys(pattern);

  const results = [];
  for (const key of keys) {
    if (key.endsWith(":latest")) continue; // Skip the latest key

    const parts = key.split(":");
    const timestamp = parseInt(parts[3]); // Updated index after adding prefix

    if (timestamp >= startTime && timestamp <= endTime) {
      const value = await client.get(key);
      if (value) {
        results.push({
          timestamp,
          data: JSON.parse(value),
        });
      }
    }
  }

  return results.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Grid Level Interface
 */
export interface GridLevel {
  price: number;
  size: number;
  status: "pending" | "filled";
}

/**
 * Get grid levels for an account and symbol
 * Key format: hypotomuai:asterdex:mmgrid:{accountId}:{symbol}:{SIDE} (uppercase)
 * Data is stored as a Redis Hash
 */
export async function getGridLevels(
  accountId: string,
  symbol: string,
  side: "buy" | "sell"
): Promise<GridLevel[]> {
  const client = getRedisClient();
  // Match the actual Redis structure: hypotomuai:asterdex:mmgrid:{accountId}:{symbol}:{SIDE}
  const sideUpper = side.toUpperCase();
  const key = `hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:${sideUpper}`;

  try {
    const data = await client.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
      return [];
    }

    // Convert hash to array of grid levels, sorted by level number
    const levels: GridLevel[] = [];
    const levelKeys = Object.keys(data).sort((a, b) => {
      const numA = parseInt(a.split("_")[1]);
      const numB = parseInt(b.split("_")[1]);
      return numA - numB;
    });

    for (const levelKey of levelKeys) {
      try {
        const levelData = JSON.parse(data[levelKey]);
        levels.push(levelData);
      } catch (e) {
        console.error(`Error parsing grid level ${levelKey}:`, e);
        console.error(`Raw data for ${levelKey}:`, data[levelKey]);
      }
    }

    return levels;
  } catch (error) {
    console.error(
      `Error getting grid levels for ${accountId}:${symbol}:${side}:`,
      error
    );
    return [];
  }
}

/**
 * Set a grid level for an account and symbol
 * Key format: hypotomuai:asterdex:mmgrid:{accountId}:{symbol}:{SIDE} (uppercase)
 * Field: level_{index}
 */
export async function setGridLevel(
  accountId: string,
  symbol: string,
  side: "buy" | "sell",
  levelIndex: number,
  level: GridLevel
): Promise<void> {
  const client = getRedisClient();
  const sideUpper = side.toUpperCase();
  const key = `hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:${sideUpper}`;
  const field = `level_${levelIndex}`;

  await client.hset(key, field, JSON.stringify(level));
}

/**
 * Clear all grid levels for an account and symbol
 */
export async function clearGridLevels(
  accountId: string,
  symbol: string,
  side?: "buy" | "sell"
): Promise<void> {
  const client = getRedisClient();

  if (side) {
    const sideUpper = side.toUpperCase();
    const key = `hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:${sideUpper}`;
    await client.del(key);
  } else {
    // Clear both buy and sell
    await client.del(`hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:BUY`);
    await client.del(`hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:SELL`);
  }
}

/**
 * Delete a specific grid level by index
 */
export async function deleteGridLevel(
  accountId: string,
  symbol: string,
  side: "buy" | "sell",
  levelIndex: number
): Promise<void> {
  const client = getRedisClient();
  const sideUpper = side.toUpperCase();
  const key = `hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:${sideUpper}`;
  const field = `level_${levelIndex}`;

  await client.hdel(key, field);
  console.log(`[Redis] Deleted grid level ${field} from ${key}`);
}

/**
 * Account State Interface
 */
export interface AccountState {
  lastMidPrice?: number;
  lastPosition?: number;
  cycleNumber?: number;
  [key: string]: any; // Allow additional fields
}

/**
 * Store account state for a symbol
 * Key format: hypotomuai:asterdex:mmgrid:state:{accountId}:{symbol}
 * TTL: 5 minutes (300 seconds)
 */
export async function setAccountState(
  accountId: string,
  symbol: string,
  state: AccountState
): Promise<void> {
  const client = getRedisClient();
  const key = `hypotomuai:asterdex:mmgrid:state:${accountId}:${symbol}`;

  // Store with 5 min TTL
  await client.setex(key, 300, JSON.stringify(state));
}

/**
 * Get account state for a symbol
 * Key format: hypotomuai:asterdex:mmgrid:state:{accountId}:{symbol}
 */
export async function getAccountState(
  accountId: string,
  symbol: string
): Promise<AccountState | null> {
  const client = getRedisClient();
  const key = `hypotomuai:asterdex:mmgrid:state:${accountId}:${symbol}`;

  try {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(
      `Error getting account state for ${accountId}:${symbol}:`,
      error
    );
    return null;
  }
}

/**
 * Market Price Interface
 */
export interface MarketPrice {
  price: number;
  timestamp: number;
}

/**
 * Store market price for a symbol
 * Key format: hypotomuai:asterdex:price:{symbol}
 * TTL: 60 seconds
 */
export async function setMarketPrice(
  symbol: string,
  price: number
): Promise<void> {
  const client = getRedisClient();
  const key = `hypotomuai:asterdex:price:${symbol}`;

  const data: MarketPrice = {
    price,
    timestamp: Date.now(),
  };

  // Store with 60 sec TTL
  await client.setex(key, 60, JSON.stringify(data));
}

/**
 * Get market price for a symbol
 * Key format: hypotomuai:asterdex:price:{symbol}
 */
export async function getMarketPrice(
  symbol: string
): Promise<MarketPrice | null> {
  const client = getRedisClient();
  const key = `hypotomuai:asterdex:price:${symbol}`;

  try {
    const value = await client.get(key);
    return value ? JSON.parse(value) : null;
  } catch (error) {
    console.error(`Error getting market price for ${symbol}:`, error);
    return null;
  }
}

/**
 * Batch get grid levels for multiple symbols in parallel
 * Much faster than calling getGridLevels multiple times sequentially
 */
export async function batchGetGridLevels(
  accountId: string,
  symbols: string[],
  side: "buy" | "sell"
): Promise<Map<string, GridLevel[]>> {
  const client = getRedisClient();
  const sideUpper = side.toUpperCase();
  const results = new Map<string, GridLevel[]>();

  // Create pipeline for batch operations
  const pipeline = client.pipeline();

  // Add all HGETALL commands to pipeline
  const keys = symbols.map(
    (symbol) => `hypotomuai:asterdex:mmgrid:${accountId}:${symbol}:${sideUpper}`
  );

  for (const key of keys) {
    pipeline.hgetall(key);
  }

  try {
    // Execute all commands in parallel
    const pipelineResults = await pipeline.exec();

    if (!pipelineResults) {
      return results;
    }

    // Process results
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      const [error, data] = pipelineResults[i];

      if (error) {
        console.error(`Error getting grid levels for ${symbol}:`, error);
        results.set(symbol, []);
        continue;
      }

      if (!data || Object.keys(data).length === 0) {
        results.set(symbol, []);
        continue;
      }

      // Convert hash to array of grid levels, sorted by level number
      const levels: GridLevel[] = [];
      const levelKeys = Object.keys(data).sort((a, b) => {
        const numA = parseInt(a.split("_")[1]);
        const numB = parseInt(b.split("_")[1]);
        return numA - numB;
      });

      for (const levelKey of levelKeys) {
        try {
          const levelData = JSON.parse((data as any)[levelKey]);
          levels.push(levelData);
        } catch (e) {
          console.error(
            `Error parsing grid level ${levelKey} for ${symbol}:`,
            e
          );
        }
      }

      results.set(symbol, levels);
    }

    return results;
  } catch (error) {
    console.error(`Error in batch get grid levels:`, error);
    return results;
  }
}

/**
 * Get both buy and sell grid levels for a symbol in parallel
 */
export async function getGridLevelsBothSides(
  accountId: string,
  symbol: string
): Promise<{ buy: GridLevel[]; sell: GridLevel[] }> {
  const [buy, sell] = await Promise.all([
    getGridLevels(accountId, symbol, "buy"),
    getGridLevels(accountId, symbol, "sell"),
  ]);

  return { buy, sell };
}
