import { v4 as uuidv4 } from "uuid";
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import {
  AhavaError,
  AhavaErrorCode,
  createSuccessResponse,
} from '@ahava/shared-errors';
import { writeAuditLog } from '@ahava/shared-audit';

const router: Router = Router();
const prisma = new PrismaClient();

// GET /products - List all products for a merchant
router.get('/', async (req, res, next) => {
  try {
    const { merchantId } = req.query;

    if (!merchantId || typeof merchantId !== 'string') {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'merchantId is required',
        { requestId: req.id },
      );
    }

    const products = await prisma.inventoryProduct.findMany({
      where: {
        merchantId,
        isActive: true,
      },
      include: {
        stock: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const serializedProducts = products.map((p) => ({
      ...p,
      priceCents: p.priceCents.toString(),
      costCents: p.costCents?.toString() ?? null,
      stock: p.stock
        ? {
            ...p.stock,
            quantity: p.stock.quantity,
            lowStockAlert: p.stock.lowStockAlert,
          }
        : null,
    }));

    res.json(
      createSuccessResponse(
        {
          products: serializedProducts,
          count: products.length,
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// POST /products - Create a new product
router.post('/', async (req, res, next) => {
  try {
    const { merchantId, name, description, category, priceCents, costCents, sku, barcode, trackStock } =
      req.body;

    if (!merchantId || !name || priceCents === undefined) {
      throw new AhavaError(
        AhavaErrorCode.VAL_MISSING_REQUIRED_FIELD,
        'merchantId, name, and priceCents are required',
        { requestId: req.id },
      );
    }

    const merchant = await prisma.user.findUnique({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Merchant not found',
        { requestId: req.id },
      );
    }

    const productId = uuidv4();
    const qrPayload = JSON.stringify({
      type: 'INVENTORY_PRODUCT',
      productId,
      merchantId,
      name,
      priceCents,
      currency: 'ZAR',
      category,
      timestamp: new Date().toISOString(),
    });

    const qrHash = createHash('sha256').update(qrPayload).digest('hex');

    const product = await prisma.inventoryProduct.create({
      data: {
        id: productId,
        merchantId,
        name,
        description,
        category,
        priceCents: BigInt(priceCents),
        costCents: costCents ? BigInt(costCents) : null,
        sku,
        barcode,
        trackStock: trackStock ?? false,
        qrPayload,
        qrHash,
      },
    });

    if (trackStock) {
      await prisma.inventoryStock.create({
        data: {
          productId: product.id,
          quantity: 0,
          lowStockAlert: 5,
        },
      });
    }

    await writeAuditLog(prisma, {
      userId: merchantId,
      action: 'PRODUCT_CREATED',
      entityType: 'inventory_product',
      entityId: product.id,
      newState: JSON.stringify({
        name,
        priceCents,
        category,
      }),
      serviceId: 'inventory-service',
      correlationId: req.id,
    });

    res.status(201).json(
      createSuccessResponse(
        {
          product: {
            ...product,
            priceCents: product.priceCents.toString(),
            costCents: product.costCents?.toString() ?? null,
            qrPayload,
            qrHash,
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// GET /products/:id - Get a single product
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const product = await prisma.inventoryProduct.findUnique({
      where: { id },
      include: {
        stock: true,
        transactions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
        },
      },
    });

    if (!product) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Product not found',
        { requestId: req.id },
      );
    }

    res.json(
      createSuccessResponse(
        {
          product: {
            ...product,
            priceCents: product.priceCents.toString(),
            costCents: product.costCents?.toString() ?? null,
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// PATCH /products/:id - Update a product
router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, category, priceCents, costCents, isActive } = req.body;

    const existingProduct = await prisma.inventoryProduct.findUnique({
      where: { id },
    });

    if (!existingProduct) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Product not found',
        { requestId: req.id },
      );
    }

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (priceCents !== undefined) updateData.priceCents = BigInt(priceCents);
    if (costCents !== undefined) updateData.costCents = BigInt(costCents);
    if (isActive !== undefined) updateData.isActive = isActive;

    const product = await prisma.inventoryProduct.update({
      where: { id },
      data: updateData,
    });

    await writeAuditLog(prisma, {
      userId: existingProduct.merchantId,
      action: 'PRODUCT_UPDATED',
      entityType: 'inventory_product',
      entityId: product.id,
      previousState: JSON.stringify({
        name: existingProduct.name,
        priceCents: existingProduct.priceCents.toString(),
      }),
      newState: JSON.stringify({
        name: product.name,
        priceCents: product.priceCents.toString(),
      }),
      serviceId: 'inventory-service',
      correlationId: req.id,
    });

    res.json(
      createSuccessResponse(
        {
          product: {
            ...product,
            priceCents: product.priceCents.toString(),
            costCents: product.costCents?.toString() ?? null,
          },
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

// DELETE /products/:id - Soft delete a product
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const product = await prisma.inventoryProduct.findUnique({
      where: { id },
    });

    if (!product) {
      throw new AhavaError(
        AhavaErrorCode.DB_NOT_FOUND,
        'Product not found',
        { requestId: req.id },
      );
    }

    await prisma.inventoryProduct.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      userId: product.merchantId,
      action: 'PRODUCT_DELETED',
      entityType: 'inventory_product',
      entityId: product.id,
      previousState: JSON.stringify({
        isActive: true,
      }),
      newState: JSON.stringify({
        isActive: false,
      }),
      serviceId: 'inventory-service',
      correlationId: req.id,
    });

    res.json(
      createSuccessResponse(
        {
          message: 'Product deactivated successfully',
          productId: id,
        },
        req.id,
      ),
    );
  } catch (error) {
    next(error);
  }
});

export default router;