import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
} from '@ahava/shared-errors';
import { writeAuditLog } from '@ahava/shared-audit';

const router = Router();
const prisma = new PrismaClient();

// GET /stock/:productId - Get stock for a product
router.get('/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;

    const stock = await prisma.inventoryStock.findUnique({
      where: { productId },
    });

    if (!stock) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Stock record not found',
        { requestId: req.id },
      );
    }

    res.json(
      createSuccessResponse(
        {
          stock: {
            ...stock,
            productId: stock.productId,
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// POST /stock/:productId/adjust - Adjust stock quantity
router.post('/:productId/adjust', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { quantityChange, reason, location } = req.body;

    if (quantityChange === undefined) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'quantityChange is required',
        { requestId: req.id },
      );
    }

    const stock = await prisma.inventoryStock.findUnique({
      where: { productId },
    });

    if (!stock) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Stock record not found',
        { requestId: req.id },
      );
    }

    const newQuantity = stock.quantity + quantityChange;
    if (newQuantity < 0) {
      throw new AhavaError(
        AhavaErrorCode.VAL_INVALID_INPUT,
        'Stock cannot go below zero',
        { requestId: req.id },
      );
    }

    const updatedStock = await prisma.inventoryStock.update({
      where: { productId },
      data: {
        quantity: newQuantity,
        lastRestocked: quantityChange > 0 ? new Date() : stock.lastRestocked,
        location: location || stock.location,
      },
    });

    await prisma.inventoryTransaction.create({
      data: {
        productId,
        type: quantityChange > 0 ? 'STOCK_IN' : 'STOCK_OUT',
        quantity: Math.abs(quantityChange),
        notes: reason || `Stock adjustment: ${quantityChange > 0 ? '+' : ''}${quantityChange}`,
      },
    });

    if (updatedStock.quantity <= updatedStock.lowStockAlert) {
      console.log(`[LOW STOCK ALERT] Product ${productId} has ${updatedStock.quantity} items left`);
    }

    const product = await prisma.inventoryProduct.findUnique({
      where: { id: productId },
    });

    await writeAuditLog(prisma, {
      userId: product?.merchantId || 'system',
      action: 'STOCK_ADJUSTED',
      entityType: 'inventory_stock',
      entityId: updatedStock.id,
      previousState: JSON.stringify({
        quantity: stock.quantity,
      }),
      newState: JSON.stringify({
        quantity: updatedStock.quantity,
      }),
      serviceId: 'inventory-service',
      correlationId: req.id,
    });

    res.json(
      createSuccessResponse(
        {
          stock: updatedStock,
          lowStockAlert: updatedStock.quantity <= updatedStock.lowStockAlert,
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

export default router;