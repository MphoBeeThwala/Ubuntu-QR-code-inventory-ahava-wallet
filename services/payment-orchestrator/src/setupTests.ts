// Mock Prisma Client for unit tests — this service's tests never hit a real
// database, so constructing a live PrismaClient here (as this file used to)
// threw PrismaClientConstructorValidationError whenever DATABASE_URL wasn't
// set, failing every test suite in the service regardless of whether it
// touched Prisma. Mirrors the pattern already used in payment-service and
// payshap-mock's setupTests.ts.
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    wallet: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    payshapTransaction: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $on: jest.fn(),
  })),
}));

// Mock date for consistent timestamps in tests
const mockDate = new Date('2026-01-01T00:00:00Z');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/test_db';
  jest.spyOn(global.Date, 'now').mockImplementation(() => mockDate.getTime());
});

afterAll(() => {
  jest.restoreAllMocks();
});

export { mockDate };
