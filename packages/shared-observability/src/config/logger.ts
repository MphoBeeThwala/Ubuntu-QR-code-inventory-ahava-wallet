import winston from "winston";
import { v4 as uuidv4 } from "uuid";

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug',
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
)

// winston's File transport throws synchronously from its constructor if it
// can't create the log directory (e.g. a read-only container filesystem,
// or a non-root user without write access to the working directory) —
// that's an uncaught exception at module-load time, which crashes the
// whole process before the app ever starts (this took down wallet-service
// in production: EACCES creating 'logs/shared' on Railway). Hosts like
// Railway already capture stdout as logs, so local log files are a
// dev-only convenience, never a production requirement — opt in
// explicitly, and never let a failure to write them be fatal.
function fileTransportsIfEnabled(serviceName: string): winston.transport[] {
  if (process.env.ENABLE_FILE_LOGGING !== 'true') return [];
  try {
    return [
      new winston.transports.File({
        filename: 'logs/' + serviceName + '/error.log',
        level: 'error',
        format: logFormat,
        maxsize: 10485760,
        maxFiles: 10,
      }),
      new winston.transports.File({
        filename: 'logs/' + serviceName + '/combined.log',
        level: process.env.LOG_LEVEL || 'info',
        format: logFormat,
        maxsize: 10485760,
        maxFiles: 10,
      }),
    ];
  } catch (error) {
    console.warn(
      `[logger] could not set up file logging for "${serviceName}", continuing with console only:`,
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

function createLogger(serviceName: string) {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    defaultMeta: { service: serviceName },
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          winston.format.simple()
        ),
      }),
      ...fileTransportsIfEnabled(serviceName),
    ],
    exitOnError: false,
  })
}

export function requestLogger(serviceName: string) {
  const logger = createLogger(serviceName)
  return (req: any, res: any, next: any) => {
    const requestId = req.headers['x-request-id'] || uuidv4()
    req.requestId = requestId
    logger.info('Request started', { requestId, method: req.method, path: req.path, ip: req.ip })
    const originalEnd = res.end
    res.end = function(this: any) {
      res.responseTime = Date.now() - (req.startTime || Date.now())
      logger.info('Request completed', { requestId, method: req.method, path: req.path, statusCode: res.statusCode, responseTime: res.responseTime })
      originalEnd.apply(res, arguments)
    }
    next()
  }
}

export function transactionLogger(serviceName: string) {
  const logger = createLogger(serviceName)
  return {
    logTransaction: (transactionType: string, amountCents: bigint, fromUserId: string, toUserId: string, status: 'success' | 'failed', error?: string) => {
      const logData = { transactionType, amountCents: amountCents.toString(), fromUserId, toUserId, status, timestamp: new Date().toISOString() }
      if (status === 'success') logger.info('Transaction completed', logData)
      else logger.error('Transaction failed', { ...logData, error })
    },
  }
}

export function auditLogger(serviceName: string) {
  const logger = createLogger(serviceName)
  return {
    logAction: (userId: string, action: string, resource: string, resourceId: string, status: 'success' | 'failed') => {
      logger.info('Audit: Action performed', { userId, action, resource, resourceId, status, timestamp: new Date().toISOString() })
    },
  }
}

export const logger = (serviceName: string) => createLogger(serviceName)
export default createLogger('shared')