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

const app = express();
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

// Import routes
import './routes/products.routes';
import './routes/stock.routes';
import './routes/transactions.routes';

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
    }
  }
}