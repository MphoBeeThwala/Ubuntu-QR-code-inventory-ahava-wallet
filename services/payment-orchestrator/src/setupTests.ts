import { PrismaClient } from '@prisma/client';

// Mock Prisma Client for unit tests
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    saga: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    sagaStep: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    sagaReversal: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    ledgerEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    fee: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    feeConfiguration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback({
      saga: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      sagaStep: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      sagaReversal: {
        create: jest.fn(),
        update: jest.fn(),
      },
      ledgerEntry: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      fee: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      feeConfiguration: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    })),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $on: jest.fn(),
  })),
}));

// Global test setup
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/test_db';
});

afterAll(() => {
  jest.clearAllMocks();
});
