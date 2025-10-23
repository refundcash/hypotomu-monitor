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
 * Key format: equity:{accountId}:{timestamp}
 */
export async function storeEquitySnapshot(
  accountId: string,
  equity: number
): Promise<void> {
  const client = getRedisClient();
  const timestamp = Date.now();
  const key = `equity:${accountId}:${timestamp}`;

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
  const pattern = `equity:${accountId}:*`;
  const keys = await client.keys(pattern);

  if (keys.length === 0) {
    return null;
  }

  // Find the key closest to 24h ago
  let closestKey: string | null = null;
  let closestDiff = Infinity;

  for (const key of keys) {
    const parts = key.split(":");
    const timestamp = parseInt(parts[2]);

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

  const pattern = "equity:*";
  const keys = await client.keys(pattern);

  const deletePromises = keys
    .filter((key) => {
      const parts = key.split(":");
      const timestamp = parseInt(parts[2]);
      return timestamp < sevenDaysAgo;
    })
    .map((key) => client.del(key));

  await Promise.all(deletePromises);
}
