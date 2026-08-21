import { PrismaClient } from '@prisma/client';

// Mock Prisma Client for unit tests
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    qrPayment: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
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

// Make PrismaClient available globally for tests
declare global {
  namespace NodeJS {
    interface Global {
      prisma: any;
    }
  }
}

global.prisma = new PrismaClient();
