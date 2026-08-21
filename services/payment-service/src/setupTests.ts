import { PrismaClient } from '@prisma/client';

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    fee: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    feeConfiguration: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    ledgerEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((callback: any) => callback({
      fee: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      feeConfiguration: {
        findUnique: jest.fn(),
      },
      ledgerEntry: {
        create: jest.fn(),
      },
    })),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $on: jest.fn(),
  })),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/test_db';
});

afterAll(() => {
  jest.clearAllMocks();
});
