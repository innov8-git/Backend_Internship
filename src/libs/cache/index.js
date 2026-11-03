const Redis = require('ioredis');
const logger = require('../logger');

let redis = null;

/**
 * Creates and returns a Redis client singleton.
 * Falls back gracefully if Redis is unavailable (logs a warning, returns null).
 */
function getRedisClient() {
  if (redis) return redis;

  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT, 10) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;

  try {
    redis = new Redis({
      host,
      port,
      password,
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) {
          logger.warn('Redis: giving up reconnection after 5 attempts');
          return null; // stop retrying
        }
        return Math.min(times * 200, 3000);
      },
      lazyConnect: true,
    });

    redis.on('connect', () => logger.info('✅ Connected to Redis'));
    redis.on('error', (err) => logger.warn('Redis error:', err.message));
    redis.on('close', () => logger.debug('Redis connection closed'));
  } catch (err) {
    logger.warn('Redis client creation failed:', err.message);
    redis = null;
  }

  return redis;
}

/**
 * Connect to Redis (lazy connect).
 */
async function connectRedis() {
  const client = getRedisClient();
  if (!client) return null;
  try {
    await client.connect();
    return client;
  } catch (err) {
    logger.warn('Redis connection failed (non-fatal):', err.message);
    return null;
  }
}

/**
 * Disconnect from Redis gracefully.
 */
async function disconnectRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('🔌 Disconnected from Redis');
  }
}

/**
 * Simple cache helpers — returns null if Redis is unavailable.
 */
const cache = {
  async get(key) {
    const client = getRedisClient();
    if (!client) return null;
    try {
      const value = await client.get(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },

  async set(key, value, ttlSeconds = 300) {
    const client = getRedisClient();
    if (!client) return;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(value));
    } catch {
      // swallow — cache is non-critical
    }
  },

  async del(key) {
    const client = getRedisClient();
    if (!client) return;
    try {
      await client.del(key);
    } catch {
      // swallow
    }
  },

  async flushPattern(pattern) {
    const client = getRedisClient();
    if (!client) return;
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) await client.del(...keys);
    } catch {
      // swallow
    }
  },
};

module.exports = { getRedisClient, connectRedis, disconnectRedis, cache };
