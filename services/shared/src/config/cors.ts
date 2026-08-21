import type { CorsOptions } from 'cors'

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  process.env.AGENT_PORTAL_URL || 'http://localhost:3001',
  'https://ubuntu-pay.co.za',
  'https://www.ubuntu-pay.co.za',
]

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true)
    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  credentials: true,
  maxAge: 86400,
}

export const corsMiddleware = (req: any, res: any, next: any) => {
  res.setHeader('Access-Control-Allow-Origin', allowedOrigins.join(', '))
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-request-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  next()
}
