import { Pool, PoolConfig } from 'pg'

// Database configuration
export const DATABASE = {
  HOST: process.env.DB_HOST || 'localhost',
  PORT: parseInt(process.env.DB_PORT || '5432'),
  USER: process.env.DB_USER || 'postgres',
  PASSWORD: process.env.DB_PASSWORD || 'postgres',
  DATABASE: process.env.DB_NAME || 'ubuntu_pay',
  
  // SSL configuration
  SSL: process.env.DB_SSL === 'true',
  SSL_CERT: process.env.DB_SSL_CERT || undefined,
  SSL_KEY: process.env.DB_SSL_KEY || undefined,
  SSL_ROOT_CERT: process.env.DB_SSL_ROOT_CERT || undefined,
  
  // Connection pool settings
  POOL: {
    min: parseInt(process.env.DB_POOL_MIN || '5'),
    max: parseInt(process.env.DB_POOL_MAX || '20'),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000'),
    connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT || '5000'),
    maxLifetimeSeconds: parseInt(process.env.DB_POOL_MAX_LIFETIME || '1800'),
  },
  
  // Statement timeout
  STATEMENT_TIMEOUT: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'),
  
  // Query timeout
  QUERY_TIMEOUT: parseInt(process.env.DB_QUERY_TIMEOUT || '10000'),
  
  // Idle in transaction timeout
  IDLE_IN_TRANSACTION_TIMEOUT: parseInt(process.env.DB_IDLE_IN_TRANSACTION_TIMEOUT || '60000'),
  
  // Application name for connection identification
  APPLICATION_NAME: process.env.DB_APPLICATION_NAME || 'ubuntu-pay-api',
  
  // Log settings
  LOG: {
    enabled: process.env.DB_LOG_ENABLED === 'true',
    level: process.env.DB_LOG_LEVEL || 'error',
  },
}

// Create connection pool
export const poolConfig: PoolConfig = {
  host: DATABASE.HOST,
  port: DATABASE.PORT,
  user: DATABASE.USER,
  password: DATABASE.PASSWORD,
  database: DATABASE.DATABASE,
  ssl: DATABASE.SSL ? {
    rejectUnauthorized: false,
    ca: DATABASE.SSL_ROOT_CERT,
    cert: DATABASE.SSL_CERT,
    key: DATABASE.SSL_KEY,
  } : false,
  min: DATABASE.POOL.min,
  max: DATABASE.POOL.max,
  idleTimeoutMillis: DATABASE.POOL.idleTimeoutMillis,
  connectionTimeoutMillis: DATABASE.POOL.connectionTimeoutMillis,
  application_name: DATABASE.APPLICATION_NAME,
}

// Singleton pool instance
let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(poolConfig)
    
    pool.on('connect', () => {
      console.log('Database connection established')
    })
    
    pool.on('error', (err) => {
      console.error('Database connection error:', err)
    })
    
    pool.on('remove', () => {
      console.log('Database connection removed')
    })
  }
  return pool
}

// Graceful shutdown
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

// Query with timeout wrapper
export async function queryWithTimeout<T>(text: string, params?: any[]): Promise<T> {
  const poolInstance = getPool()
  const client = await poolInstance.connect()
  
  try {
    const result = await client.query<T>({ text, values: params })
    return result.rows[0]
  } finally {
    client.release()
  }
}

// Transaction helper
export async function withTransaction<T>(callback: (client: any) => Promise<T>): Promise<T> {
  const poolInstance = getPool()
  const client = await poolInstance.connect()
  
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export type DatabaseConfig = typeof DATABASE
