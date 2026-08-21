import type { PoolClient } from 'pg'

// Pagination helper with optimized queries
export interface PaginationOptions {
  page?: number
  pageSize?: number
  orderBy?: string
  orderDirection?: 'ASC' | 'DESC'
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasNextPage: boolean
    hasPreviousPage: boolean
  }
}

export function buildPaginationQuery(
  baseQuery: string,
  countQuery: string,
  options: PaginationOptions = {}
): { query: string; params: any[]; countQuery: string } {
  const page = options.page || 1
  const pageSize = options.pageSize || 20
  const offset = (page - 1) * pageSize
  
  const orderBy = options.orderBy || 'created_at'
  const orderDirection = options.orderDirection || 'DESC'
  
  const params: any[] = [pageSize, offset]
  
  const query = `
    ${baseQuery}
    ORDER BY ${orderBy} ${orderDirection}
    LIMIT $1 OFFSET $2
  `
  
  return {
    query,
    params,
    countQuery: `SELECT COUNT(*) FROM (${countQuery}) AS count_query`,
  }
}

// Batch processing helper
export async function batchProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  batchSize: number = 100
): Promise<R[]> {
  const results: R[] = []
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map((item, index) => processor(item, i + index))
    )
    results.push(...batchResults)
  }
  
  return results
}

// Chunk processing with transaction
export async function chunkedTransaction<T>(
  client: PoolClient,
  items: T[],
  processor: (item: T, client: PoolClient) => Promise<void>,
  chunkSize: number = 100
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    
    await client.query('BEGIN')
    
    try {
      for (const item of chunk) {
        await processor(item, client)
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    }
  }
}

// Query caching decorator
export function cacheQuery<T>(
  keyPrefix: string,
  ttl: number = 60
) {
  return async (
    queryFn: () => Promise<T>,
    cacheClient: { get: (key: string) => Promise<string | null>; setEx: (key: string, ttl: number, value: string) => Promise<void> }
  ): Promise<T> => {
    const cacheKey = `${keyPrefix}:${JSON.stringify({})}`
    
    const cached = await cacheClient.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as T
    }
    
    const result = await queryFn()
    await cacheClient.setEx(cacheKey, ttl, JSON.stringify(result))
    
    return result
  }
}

// BIGINT safe JSON serialization
export function serializeBigInt(obj: any): string {
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'bigint') {
      return { __bigint__: true, value: value.toString() }
    }
    return value
  })
}

export function deserializeBigInt(json: string): any {
  return JSON.parse(json, (key, value) => {
    if (value && value.__bigint__ === true) {
      return BigInt(value.value)
    }
    return value
  })
}

// Pagination metadata
export function getPaginationMetadata(
  totalItems: number,
  page: number = 1,
  pageSize: number = 20
): PaginatedResult<any>['pagination'] {
  const totalPages = Math.ceil(totalItems / pageSize)
  
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  }
}

// Index recommendation for queries
export const INDEX_RECOMMENDATIONS = {
  users: {
    phone: 'UNIQUE',
    email: 'UNIQUE',
    created_at: 'INDEX',
  },
  wallets: {
    user_id: 'UNIQUE',
    balance_cents: 'INDEX',
  },
  transactions: {
    user_id: 'INDEX',
    type: 'INDEX',
    status: 'INDEX',
    created_at: 'INDEX',
    from_user_id: 'INDEX',
    to_user_id: 'INDEX',
  },
  payments: {
    user_id: 'INDEX',
    status: 'INDEX',
    reference_id: 'UNIQUE',
    created_at: 'INDEX',
  },
  qr_codes: {
    reference_id: 'UNIQUE',
    user_id: 'INDEX',
    expires_at: 'INDEX',
  },
  ledger_entries: {
    account_id: 'INDEX',
    type: 'INDEX',
    reference_id: 'INDEX',
    created_at: 'INDEX',
  },
}
