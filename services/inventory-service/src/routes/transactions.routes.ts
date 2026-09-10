import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
} from '@ahava/shared-errors';
import { requireAuth, assertOwnerOrAgent } from '../middleware/auth.middleware';

const router: Router = Router();
const prisma = new PrismaClient();

// GET /transactions - List inventory transactions for a merchant
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { merchantId, productId, type, limit = 50, offset = 0 } = req.query;

    // merchantId used to be optional — omitting it returned every
    // merchant's transaction history unfiltered. Now required, and
    // productId (ANDed into the same query below) can't be used to widen
    // the scope past merchantId's own products.
    if (!merchantId || typeof merchantId !== 'string') {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'merchantId is required',
        { requestId: req.id },
      );
    }
    assertOwnerOrAgent(req, merchantId);

    const where: any = {
      product: { merchantId },
    };
    if (productId) {
      where.productId = productId as string;
    }
    if (type) {
      where.type = type as string;
    }

    const transactions = await prisma.inventoryTransaction.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            name: true,
            priceCents: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: Number(limit),
      skip: Number(offset),
    });

    const serialized = transactions.map((t) => ({
      ...t,
      unitPriceCents: t.unitPriceCents?.toString() ?? null,
      totalCents: t.totalCents?.toString() ?? null,
      product: {
        ...t.product,
        priceCents: t.product.priceCents.toString(),
      },
    }));

    res.json(
      createSuccessResponse(
        {
          transactions: serialized,
          count: transactions.length,
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// POST /transactions/sale - Record a sale (called from payment service)
// Nothing currently calls this despite the comment — grepped payment-service
// and wallet-service for it, neither exists. Requires the product's owner
// (or an agent) rather than leaving it open, so a merchant can't fabricate
// sale records or deplete a competitor's stock through it if it's ever
// wired up as designed.
router.post('/sale', requireAuth, async (req, res, next) => {
  try {
    const { walletTransactionId, productId, quantity = 1 } = req.body;

    if (!walletTransactionId || !productId) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'walletTransactionId and productId are required',
        { requestId: req.id },
      );
    }

    const product = await prisma.inventoryProduct.findUnique({
      where: { id: productId },
      include: { stock: true },
    });

    if (!product) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Product not found',
        { requestId: req.id },
      );
    }

    assertOwnerOrAgent(req, product.merchantId);

    const walletTxn = await prisma.walletTransaction.findUnique({
      where: { id: walletTransactionId },
    });

    if (!walletTxn) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Wallet transaction not found',
        { requestId: req.id },
      );
    }

    const inventoryTxn = await prisma.inventoryTransaction.create({
      data: {
        productId,
        type: 'SALE',
        quantity,
        unitPriceCents: product.priceCents,
        totalCents: product.priceCents * BigInt(quantity),
        walletTransactionId,
        notes: `Sale via wallet transaction ${walletTransactionId}`,
      },
    });

    if (product.trackStock && product.stock) {
      const newQuantity = product.stock.quantity - quantity;
      await prisma.inventoryStock.update({
        where: { productId },
        data: {
          quantity: newQuantity,
        },
      });
    }

    res.status(201).json(
      createSuccessResponse(
        {
          transaction: {
            ...inventoryTxn,
            unitPriceCents: inventoryTxn.unitPriceCents?.toString() ?? null,
            totalCents: inventoryTxn.totalCents?.toString() ?? null,
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

export default router;