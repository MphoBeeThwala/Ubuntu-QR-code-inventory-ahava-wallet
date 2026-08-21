import type { Request, Response, NextFunction } from 'express'
import { createClient, RedisClientType } from 'redis'

// Redis client singleton
let redisClient: RedisClientType | null = null

async function getRedisClient(): Promise<RedisClientType> {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 100, 5000),
      },
    })
    
    redisClient.on('error', (err) => {
      console.error('Redis error:', err)
    })
    
    await redisClient.connect()
  }
  return redisClient
}

export interface CacheOptions {
  key: string
  ttl?: number
  prefix?: string
}

export async function cacheMiddleware(options: CacheOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const client = await getRedisClient()
    const cacheKey = options.prefix ? `${options.prefix}:${options.key}` : options.key
    
    try {
      const cached = await client.get(cacheKey)
      if (cached) {
        res.set('X-Cache', 'HIT')
        return res.json(JSON.parse(cached))
      }
      
      res.set('X-Cache', 'MISS')
      
      // Override res.json to cache the response
      const originalJson = res.json
      res.json = function(data: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheTtl = options.ttl || 300 // Default 5 minutes
          client.setEx(cacheKey, cacheTtl, JSON.stringify(data))
        }
        originalJson.call(this, data)
      }
      
      next()
    } catch (err) {
      res.set('X-Cache', 'BYPASS')
      next()
    }
  }
}

export async function invalidateCache(pattern: string): Promise<number> {
  const client = await getRedisClient()
  const keys = await client.keys(pattern)
  
  if (keys.length > 0) {
    await client.del(keys)
  }
  
  return keys.length
}

export async function clearAllCache(): Promise<void> {
  const client = await getRedisClient()
  await client.flushDb()
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
  }
}

// Cache user wallet balance
interface WalletCache {
  balanceCents: bigint
  updatedAt: number
  ttl: number
}

export async function cacheWalletBalance(userId: string, balanceCents: bigint, ttl: number = 60): Promise<void> {
  const client = await getRedisClient()
  const cacheData: WalletCache = {
    balanceCents: balanceCents,
    updatedAt: Date.now(),
    ttl: ttl * 1000,
  }
  await client.setEx(`wallet:${userId}`, ttl, JSON.stringify(cacheData))
}

export async function getCachedWalletBalance(userId: string): Promise<bigint | null> {
  const client = await getRedisClient()
  const cached = await client.get(`wallet:${userId}`)
  
  if (cached) {
    const data: WalletCache = JSON.parse(cached)
    // Convert back to BigInt
    return BigInt(data.balanceCents)
  }
  
  return null
}

// Cache user data
export async function cacheUser(userId: string, userData: any, ttl: number = 300): Promise<void> {
  const client = await getRedisClient()
  await client.setEx(`user:${userId}`, ttl, JSON.stringify(userData))
}

export async function getCachedUser(userId: string): Promise<any | null> {
  const client = await getRedisClient()
  const cached = await client.get(`user:${userId}`)
  return cached ? JSON.parse(cached) : null
}