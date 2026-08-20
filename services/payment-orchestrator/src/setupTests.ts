import { PrismaClient } from '@prisma/client';

// Singleton Prisma Client for testing
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    },
  },
});

// Mock date for consistent timestamps in tests
const mockDate = new Date('2026-01-01T00:00:00Z');

beforeAll(() => {
  jest.spyOn(global.Date, 'now').mockImplementation(() => mockDate.getTime());
});

afterAll(async () => {
  jest.restoreAllMocks();
  await prisma.$disconnect();
});

export { prisma, mockDate };
