import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
  createErrorResponse,
} from '@ahava/shared-errors';
import { writeAuditLog } from '@ahava/shared-audit';

const app: express.Express = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 6010;

app.use(express.json());

// Request ID middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const incoming = req.get('X-Request-ID');
  const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : uuidv4();
  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json(createSuccessResponse({ status: 'ok', service: 'inventory-service' }, req.id));
});

// Mount routes. api-gateway forwards the full request path unchanged (see
// proxyRequest in services/api-gateway/src/main.ts — no prefix stripping),
// and every other service in this codebase defines routes with that full
// gateway-facing path baked in (e.g. wallet-service's
// app.get("/wallets/:walletId", ...), not app.get("/:walletId", ...)
// mounted under "/wallets"). These routers were previously imported only
// for their side effects and never actually registered with app.use() at
// all — none of products/stock/transactions routes were reachable via
// HTTP; this service served nothing but /health.
import productsRouter from './routes/products.routes';
import stockRouter from './routes/stock.routes';
import transactionsRouter from './routes/transactions.routes';

app.use('/inventory/products', productsRouter);
app.use('/inventory/stock', stockRouter);
app.use('/inventory/transactions', transactionsRouter);

// Error handling
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AhavaError) {
    return res.status(err.statusCode).json(createErrorResponse(err));
  }
  console.error('Unhandled error:', err);
  const genericError = new AhavaError(
    AhavaErrorCode.INTERNAL_SERVER_ERROR,
    'Internal server error',
    { requestId: req.id },
  );
  res.status(500).json(createErrorResponse(genericError));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Inventory Service listening on port ${PORT}`);
    console.log(`🏥 Health: http://localhost:${PORT}/health`);
  });
}

export default app;

declare global {
  namespace Express {
    interface Request {
      id?: string;
      userId?: string;
      role?: string;
    }
  }
}