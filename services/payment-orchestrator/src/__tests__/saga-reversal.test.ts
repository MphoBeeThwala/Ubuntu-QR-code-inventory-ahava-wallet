import {
  createSaga,
  addStepsToSaga,
  executeSaga,
  reverseSaga,
  canReverseSaga,
  getSagaReversalStatus,
  getSaga,
  getSagaSteps,
  registerSagaDefinition,
  SAGA_STATUS,
  SAGA_STEP_STATUS,
} from './saga-reversal';
import { SAGA_TYPES } from './constants/saga-types';

// Mock Prisma Client
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
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    fee: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
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
    })),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $on: jest.fn(),
  })),
}));

const prisma = new (require('@prisma/client').PrismaClient)();

describe('Saga Reversal Service (BATCH 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset registered saga definitions
    const sagaReversalModule = require('./saga-reversal');
    const originalDefinitions = sagaReversalModule.sagaDefinitions;
    for (const key in originalDefinitions) {
      delete originalDefinitions[key];
    }
  });

  describe('createSaga', () => {
    it('should create a new saga with PENDING status', async () => {
      (prisma as any).saga.create.mockResolvedValue({
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.PENDING,
        totalSteps: 0,
        currentStep: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const saga = await createSaga({
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        userId: 'user-1',
      });

      expect(saga.id).toBe('saga-1');
      expect(saga.status).toBe(SAGA_STATUS.PENDING);
      expect(saga.sagaType).toBe(SAGA_TYPES.PAYMENT);
    });

    it('should set totalSteps based on saga definition', async () => {
      // Register a saga definition first
      registerSagaDefinition({
        sagaType: SAGA_TYPES.PAYMENT,
        steps: [
          { stepType: 'STEP1', action: 'Action 1', execute: jest.fn(), isIdempotent: true },
          { stepType: 'STEP2', action: 'Action 2', execute: jest.fn(), isIdempotent: true },
          { stepType: 'STEP3', action: 'Action 3', execute: jest.fn(), isIdempotent: true },
        ],
      });

      (prisma as any).saga.create.mockResolvedValue({
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.PENDING,
        totalSteps: 3,
        currentStep: 0,
      });

      const saga = await createSaga({
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
      });

      expect(saga.totalSteps).toBe(3);
    });
  });

  describe('addStepsToSaga', () => {
    it('should add multiple steps to a saga', async () => {
      const steps = [
        { stepType: 'STEP1', action: 'Action 1', execute: jest.fn(), isIdempotent: true },
        { stepType: 'STEP2', action: 'Action 2', execute: jest.fn(), isIdempotent: true },
      ];

      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        steps: [],
      });

      (prisma as any).sagaStep.create
        .mockResolvedValueOnce({ id: 'step-1', sagaId: 'saga-1', stepNumber: 1 })
        .mockResolvedValueOnce({ id: 'step-2', sagaId: 'saga-1', stepNumber: 2 });

      const createdSteps = await addStepsToSaga('saga-1', steps);

      expect(createdSteps.length).toBe(2);
      expect(createdSteps[0].sagaId).toBe('saga-1');
      expect(createdSteps[0].stepNumber).toBe(1);
      expect(createdSteps[1].stepNumber).toBe(2);
    });
  });

  describe('executeSaga', () => {
    it('should execute saga steps in order', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.PENDING,
        currentStep: 0,
        steps: [
          { id: 'step-1', stepNumber: 1, status: SAGA_STEP_STATUS.PENDING },
          { id: 'step-2', stepNumber: 2, status: SAGA_STEP_STATUS.PENDING },
        ],
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);
      (prisma as any).saga.update.mockResolvedValue(saga);
      (prisma as any).sagaStep.findMany.mockResolvedValue(saga.steps);

      // Mock step execution
      registerSagaDefinition({
        sagaType: SAGA_TYPES.PAYMENT,
        steps: [
          {
            stepType: 'STEP1',
            action: 'Action 1',
            execute: jest.fn().mockResolvedValue({ result: 'success' }),
            isIdempotent: true,
          },
          {
            stepType: 'STEP2',
            action: 'Action 2',
            execute: jest.fn().mockResolvedValue({ result: 'success' }),
            isIdempotent: true,
          },
        ],
      });

      (prisma as any).sagaStep.update.mockResolvedValue({});

      const result = await executeSaga('saga-1');

      expect(result.success).toBe(true);
      expect(prisma.saga.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'saga-1' },
          data: expect.objectContaining({
            status: SAGA_STATUS.COMPLETED,
          }),
        })
      );
    });

    it('should mark saga as FAILED when a step fails', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.PENDING,
        currentStep: 0,
        steps: [
          { id: 'step-1', stepNumber: 1, status: SAGA_STEP_STATUS.PENDING },
          { id: 'step-2', stepNumber: 2, status: SAGA_STEP_STATUS.PENDING },
        ],
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);
      (prisma as any).saga.update.mockResolvedValue(saga);
      (prisma as any).sagaStep.findMany.mockResolvedValue(saga.steps);

      // Mock first step to succeed, second to fail
      registerSagaDefinition({
        sagaType: SAGA_TYPES.PAYMENT,
        steps: [
          {
            stepType: 'STEP1',
            action: 'Action 1',
            execute: jest.fn().mockResolvedValue({ result: 'success' }),
            isIdempotent: true,
          },
          {
            stepType: 'STEP2',
            action: 'Action 2',
            execute: jest.fn().mockRejectedValue(new Error('Step 2 failed')),
            isIdempotent: true,
          },
        ],
      });

      (prisma as any).sagaStep.update.mockResolvedValue({});
      (prisma as any).reverseSaga = jest.fn().mockResolvedValue({});

      await expect(executeSaga('saga-1')).rejects.toThrow('Step 2 failed');

      expect(prisma.saga.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'saga-1' },
          data: expect.objectContaining({
            status: SAGA_STATUS.FAILED,
          }),
        })
      );
    });
  });

  describe('reverseSaga', () => {
    it('should create a reversal record', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.FAILED,
        steps: [
          { id: 'step-1', stepNumber: 1, status: SAGA_STEP_STATUS.COMPLETED },
          { id: 'step-2', stepNumber: 2, status: SAGA_STEP_STATUS.FAILED },
        ],
        reversal: null,
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);
      (prisma as any).sagaReversal.create.mockResolvedValue({
        id: 'reversal-1',
        originalSagaId: 'saga-1',
        status: SAGA_STATUS.REVERSING,
      });
      (prisma as any).saga.update.mockResolvedValue(saga);
      (prisma as any).sagaReversal.update.mockResolvedValue({});

      registerSagaDefinition({
        sagaType: SAGA_TYPES.PAYMENT,
        steps: [
          {
            stepType: 'STEP1',
            action: 'Action 1',
            execute: jest.fn(),
            compensate: jest.fn().mockResolvedValue({}),
            isIdempotent: true,
          },
          {
            stepType: 'STEP2',
            action: 'Action 2',
            execute: jest.fn(),
            compensate: jest.fn().mockResolvedValue({}),
            isIdempotent: true,
          },
        ],
      });

      (prisma as any).sagaStep.update.mockResolvedValue({});

      const result = await reverseSaga('saga-1', 'Test reversal');

      expect(result.success).toBe(true);
      expect(prisma.sagaReversal.create).toHaveBeenCalled();
      expect(prisma.saga.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'saga-1' },
          data: expect.objectContaining({
            status: SAGA_STATUS.REVERSED,
          }),
        })
      );
    });

    it('should skip steps that are not completed', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.FAILED,
        steps: [
          { id: 'step-1', stepNumber: 1, status: SAGA_STEP_STATUS.COMPLETED },
          { id: 'step-2', stepNumber: 2, status: SAGA_STEP_STATUS.PENDING },
          { id: 'step-3', stepNumber: 3, status: SAGA_STEP_STATUS.FAILED },
        ],
        reversal: null,
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);
      (prisma as any).sagaReversal.create.mockResolvedValue({
        id: 'reversal-1',
        originalSagaId: 'saga-1',
      });
      (prisma as any).saga.update.mockResolvedValue(saga);
      (prisma as any).sagaReversal.update.mockResolvedValue({});

      const compensateMock = jest.fn().mockResolvedValue({});

      registerSagaDefinition({
        sagaType: SAGA_TYPES.PAYMENT,
        steps: [
          {
            stepType: 'STEP1',
            action: 'Action 1',
            execute: jest.fn(),
            compensate: compensateMock,
            isIdempotent: true,
          },
          {
            stepType: 'STEP2',
            action: 'Action 2',
            execute: jest.fn(),
            compensate: jest.fn(),
            isIdempotent: true,
          },
          {
            stepType: 'STEP3',
            action: 'Action 3',
            execute: jest.fn(),
            compensate: jest.fn(),
            isIdempotent: true,
          },
        ],
      });

      (prisma as any).sagaStep.update.mockResolvedValue({});

      await reverseSaga('saga-1', 'Test reversal');

      // Only step 1 should be compensated (it's the only COMPLETED step)
      expect(compensateMock).toHaveBeenCalledTimes(1);
    });

    it('should mark saga as PARTIALLY_REVERSED if some steps fail to compensate', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        transactionId: 'txn-1',
        walletId: 'wallet-1',
        status: SAGA_STATUS.FAILED,
        steps: [
          { id: 'step-1', stepNumber: 1, status: SAGA_STEP_STATUS.COMPLETED },
          { id: 'step-2', stepNumber: 2, status: SAGA_STEP_STATUS.COMPLETED },
        ],
        reversal: null,
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);
      (prisma as any).sagaReversal.create.mockResolvedValue({
        id: 'reversal-1',
        originalSagaId: 'saga-1',
      });
      (prisma as any).saga.update.mockResolvedValue(saga);
      (prisma as any).sagaReversal.update.mockResolvedValue({});

      const compensate1 = jest.fn().mockResolvedValue({});
      const compensate2 = jest.fn().mockRejectedValue(new Error('Compensation failed'));

      registerSagaDefinition({
        sagaType: SAGA_TYPES.PAYMENT,
        steps: [
          {
            stepType: 'STEP1',
            action: 'Action 1',
            execute: jest.fn(),
            compensate: compensate1,
            isIdempotent: true,
          },
          {
            stepType: 'STEP2',
            action: 'Action 2',
            execute: jest.fn(),
            compensate: compensate2,
            isIdempotent: true,
          },
        ],
      });

      (prisma as any).sagaStep.update.mockResolvedValue({});

      const result = await reverseSaga('saga-1', 'Test reversal');

      expect(result.success).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(prisma.sagaReversal.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'reversal-1' },
          data: expect.objectContaining({
            status: SAGA_STATUS.PARTIALLY_REVERSED,
          }),
        })
      );
    });
  });

  describe('canReverseSaga', () => {
    it('should return true for FAILED saga', async () => {
      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        status: SAGA_STATUS.FAILED,
      });

      const result = await canReverseSaga('saga-1');
      expect(result).toBe(true);
    });

    it('should return true for COMPLETED saga', async () => {
      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        status: SAGA_STATUS.COMPLETED,
      });

      const result = await canReverseSaga('saga-1');
      expect(result).toBe(true);
    });

    it('should return false for REVERSING saga', async () => {
      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        status: SAGA_STATUS.REVERSING,
      });

      const result = await canReverseSaga('saga-1');
      expect(result).toBe(false);
    });

    it('should return false for REVERSED saga', async () => {
      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        status: SAGA_STATUS.REVERSED,
      });

      const result = await canReverseSaga('saga-1');
      expect(result).toBe(false);
    });

    it('should return false for RUNNING saga', async () => {
      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        status: SAGA_STATUS.RUNNING,
      });

      const result = await canReverseSaga('saga-1');
      expect(result).toBe(false);
    });
  });

  describe('getSagaReversalStatus', () => {
    it('should return reversal status', async () => {
      const reversal = {
        id: 'reversal-1',
        originalSagaId: 'saga-1',
        status: SAGA_STATUS.REVERSED,
        stepsReversed: 5,
        totalSteps: 5,
      };

      (prisma as any).saga.findUnique.mockResolvedValue({
        id: 'saga-1',
        status: SAGA_STATUS.REVERSED,
        reversal,
      });

      const result = await getSagaReversalStatus('saga-1');

      expect(result.exists).toBe(true);
      expect(result.reversal).toEqual(reversal);
      expect(result.canReverse).toBe(false);
    });

    it('should return exists=false for non-existent saga', async () => {
      (prisma as any).saga.findUnique.mockResolvedValue(null);

      const result = await getSagaReversalStatus('saga-999');

      expect(result.exists).toBe(false);
    });
  });

  describe('Idempotency', () => {
    it('should prevent duplicate reversal', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        status: SAGA_STATUS.FAILED,
        steps: [],
        reversal: { id: 'reversal-1' },
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);

      const result = await reverseSaga('saga-1', 'Test');

      expect(result.message).toContain('already in progress');
    });

    it('should not reverse already reversed saga', async () => {
      const saga = {
        id: 'saga-1',
        sagaType: SAGA_TYPES.PAYMENT,
        status: SAGA_STATUS.REVERSED,
        steps: [],
        reversal: null,
      };

      (prisma as any).saga.findUnique.mockResolvedValue(saga);

      const result = await canReverseSaga('saga-1');

      expect(result).toBe(false);
    });
  });
});
