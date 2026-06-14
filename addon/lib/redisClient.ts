import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis: Redis | null = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
  enableAutoPipelining: true,
  keepAlive: 240000,
});

if (redis) {
  redis.on('error', (err: Error) => {
    console.error('Redis Client Error:', err);
  });
  redis.on('connect', () => console.log('Redis client connected.'));
  redis.on('ready', () => {
    console.log('Redis client ready.');
    // Ping every 4 minutes to keep connection alive
    setInterval(() => {
      redis.ping().catch((err: Error) => {
        console.error('Redis keepalive ping failed:', err);
      });
    }, 240000);
  });
  redis.on('close', () => console.log('Redis client connection closed.'));
  redis.on('reconnecting', () => console.log('Redis client reconnecting...'));
}

export default redis;
module.exports = redis;
