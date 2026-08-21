import { PrismaClient, SagaStatus, SagaStepStatus } from '@prisma/client';
import { SAGA_TYPES, SAGA_STATUS, SAGA_STEP_STATUS, MAX_SAGA_RETRIES } from './constants/saga-types';

const prisma = new PrismaClient();

/**
 * Saga Reversal Service (BATCH 5)
 * 
 * Provides capabilities to:
 * - Create and track sagas
 * - Execute saga steps with rollback on failure
 * - Reverse completed or failed sagas
 * - Compensate for partial failures
 * - Ensure idempotent reversal operations
 */

// ============================================
// Type Definitions
// ============================================

interface SagaStepDefinition {
  stepType: string;
  action: string;
  execute: (saga: any, step: any) => Promise<any>;
  compensate?: (saga: any, step: any) => Promise<any>;
  isIdempotent?: boolean;
}

interface SagaDefinition {
  sagaType: string;
  steps: SagaStepDefinition[];
}

interface CreateSagaInput {
  sagaType: string;
  transactionId: string;
  walletId: string;
  userId?: string;
  metadata?: any;
}

interface ExecuteStepInput {
  sagaId: string;
  stepNumber: number;
  stepType: string;
  action: string;
  result?: any;
  errorMessage?: string;
}

// ============================================
// Saga Creation
// ============================================

/**
 * Create a new saga
 */
export async function createSaga(input: CreateSagaInput) {
  const totalSteps = getSagaDefinition(input.sagaType)?.steps.length || 0;

  return await prisma.saga.create({
    data: {
      sagaType: input.sagaType,
      transactionId: input.transactionId,
      walletId: input.walletId,
      userId: input.userId,
      status: SAGA_STATUS.PENDING as SagaStatus,
      totalSteps,
      metadata: input.metadata,
    },
    include: { steps: true },
  });
}

/**
 * Add steps to a saga
 */
export async function addStepsToSaga(sagaId: string, steps: SagaStepDefinition[]) {
  const saga = await prisma.saga.findUnique({
    where: { id: sagaId },
    include: { steps: true },
  });

  if (!saga) {
    throw new Error('Saga not found: ' + sagaId);
  }

  const stepCreations = steps.map((stepDef, index) => {
    const stepNumber = saga.steps.length + index + 1;
    return prisma.sagaStep.create({
      data: {
        sagaId,
        stepNumber,
        stepType: stepDef.stepType,
        action: stepDef.action,
        status: SAGA_STEP_STATUS.PENDING as SagaStepStatus,
      },
    });
  });

  return await Promise.all(stepCreations);
}

// ============================================
// Saga Execution
// ============================================

/**
 * Execute a saga step by step
 */
export async function executeSaga(sagaId: string) {
  const saga = await prisma.saga.findUnique({
    where: { id: sagaId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });

  if (!saga) {
    throw new Error('Saga not found: ' + sagaId);
  }

  if (saga.status !== SAGA_STATUS.PENDING && saga.status !== SAGA_STATUS.RUNNING) {
    throw new Error('Cannot execute saga with status: ' + saga.status);
  }

  // Update saga status to RUNNING
  await prisma.saga.update({
    where: { id: sagaId },
    data: {
      status: SAGA_STATUS.RUNNING as SagaStatus,
      startedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const sagaDef = getSagaDefinition(saga.sagaType);
  if (!sagaDef) {
    throw new Error('Unknown saga type: ' + saga.sagaType);
  }

  let currentStep = saga.currentStep || 0;
  const errors: any[] = [];

  for (const step of saga.steps) {
    if (step.status === SAGA_STEP_STATUS.COMPLETED) {
      currentStep++;
      continue; // Skip already completed steps
    }

    const stepDef = sagaDef.steps[step.stepNumber - 1];
    if (!stepDef) {
      throw new Error('Step definition not found for step: ' + step.stepNumber);
    }

    try {
      // Mark step as running
      await prisma.sagaStep.update({
        where: { id: step.id },
        data: {
          status: SAGA_STEP_STATUS.RUNNING as SagaStepStatus,
          startedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Execute the step
      const result = await stepDef.execute(saga, step);

      // Mark step as completed
      await prisma.sagaStep.update({
        where: { id: step.id },
        data: {
          status: SAGA_STEP_STATUS.COMPLETED as SagaStepStatus,
          result,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Update saga progress
      currentStep++;
      await prisma.saga.update({
        where: { id: sagaId },
        data: {
          currentStep,
          updatedAt: new Date(),
        },
      });

    } catch (error: any) {
      // Mark step as failed
      await prisma.sagaStep.update({
        where: { id: step.id },
        data: {
          status: SAGA_STEP_STATUS.FAILED as SagaStepStatus,
          errorMessage: error.message,
          updatedAt: new Date(),
        },
      });

      errors.push({
        stepNumber: step.stepNumber,
        stepType: step.stepType,
        error: error.message,
        timestamp: new Date().toISOString(),
      });

      // Mark saga as failed
      await prisma.saga.update({
        where: { id: sagaId },
        data: {
          status: SAGA_STATUS.FAILED as SagaStatus,
          failedAt: new Date(),
          errorMessage: error.message,
          updatedAt: new Date(),
        },
      });

      // Trigger reversal for failed saga
      await reverseSaga(sagaId, 'Step ' + step.stepNumber + ' failed: ' + error.message);

      throw error; // Re-throw to stop execution
    }
  }

  // All steps completed successfully
  await prisma.saga.update({
    where: { id: sagaId },
    data: {
      status: SAGA_STATUS.COMPLETED as SagaStatus,
      completedAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return { success: true, errors };
}

// ============================================
// Saga Reversal (Core BATCH 5 Functionality)
// ============================================

/**
 * Reverse a saga (compensate for failed or completed saga)
 * This is the main function for BATCH 5
 */
export async function reverseSaga(sagaId: string, reason?: string) {
  const saga = await prisma.saga.findUnique({
    where: { id: sagaId },
    include: { 
      steps: { 
        orderBy: { stepNumber: 'desc' }, // Reverse order for compensation
        include: { reversalSagaId: true }
      },
      reversal: true
    },
  });

  if (!saga) {
    throw new Error('Saga not found: ' + sagaId);
  }

  // Check if already reversing or reversed
  if (saga.status === SAGA_STATUS.REVERSING || saga.status === SAGA_STATUS.REVERSED) {
    console.log('Saga already reversing or reversed:', sagaId);
    return { success: true, message: 'Already reversing or reversed' };
  }

  // Check if there's already a reversal in progress
  if (saga.reversal) {
    console.log('Reversal already in progress:', saga.reversal.id);
    return { success: true, message: 'Reversal already in progress' };
  }

  // Create reversal record
  const totalSteps = saga.steps.length;
  const reversal = await prisma.sagaReversal.create({
    data: {
      originalSagaId: sagaId,
      status: SAGA_STATUS.REVERSING as SagaStatus,
      reason,
      initiatedBy: 'SYSTEM',
      initiatedAt: new Date(),
      totalSteps,
      metadata: { originalStatus: saga.status },
    },
  });

  // Update saga status to REVERSING
  await prisma.saga.update({
    where: { id: sagaId },
    data: {
      status: SAGA_STATUS.REVERSING as SagaStatus,
      updatedAt: new Date(),
    },
  });

  const sagaDef = getSagaDefinition(saga.sagaType);
  if (!sagaDef) {
    throw new Error('Unknown saga type: ' + saga.sagaType);
  }

  let stepsReversed = 0;
  const errors: any[] = [];

  // Process steps in reverse order for compensation
  for (const step of saga.steps) {
    if (step.status !== SAGA_STEP_STATUS.COMPLETED) {
      // Only completed steps need compensation
      continue;
    }

    const stepDef = sagaDef.steps[step.stepNumber - 1];
    if (!stepDef || !stepDef.compensate) {
      console.log('No compensation defined for step:', step.stepType);
      continue;
    }

    try {
      // Mark step as reversing
      await prisma.sagaStep.update({
        where: { id: step.id },
        data: {
          status: SAGA_STEP_STATUS.REVERSING as SagaStepStatus,
          updatedAt: new Date(),
        },
      });

      // Execute compensation
      await stepDef.compensate(saga, step);

      // Mark step as reversed
      await prisma.sagaStep.update({
        where: { id: step.id },
        data: {
          status: SAGA_STEP_STATUS.REVERSED as SagaStepStatus,
          updatedAt: new Date(),
        },
      });

      stepsReversed++;

    } catch (error: any) {
      console.error('Failed to compensate step', step.stepNumber, ':', error.message);
      
      // Mark step as failed to reverse
      await prisma.sagaStep.update({
        where: { id: step.id },
        data: {
          status: SAGA_STEP_STATUS.FAILED as SagaStepStatus,
          errorMessage: 'Compensation failed: ' + error.message,
          updatedAt: new Date(),
        },
      });

      errors.push({
        stepNumber: step.stepNumber,
        stepType: step.stepType,
        error: error.message,
      });
    }
  }

  // Update reversal record
  await prisma.sagaReversal.update({
    where: { id: reversal.id },
    data: {
      stepsReversed,
      status: errors.length > 0 ? SAGA_STATUS.PARTIALLY_REVERSED as SagaStatus : SAGA_STATUS.REVERSED as SagaStatus,
      completedAt: new Date(),
      errorMessage: errors.length > 0 ? 'Partial reversal: ' + errors.length + ' steps failed' : null,
      updatedAt: new Date(),
    },
  });

  // Update saga status
  const finalStatus = errors.length > 0 ? SAGA_STATUS.PARTIALLY_REVERSED : SAGA_STATUS.REVERSED;
  await prisma.saga.update({
    where: { id: sagaId },
    data: {
      status: finalStatus as SagaStatus,
      reversedAt: new Date(),
      errorMessage: errors.length > 0 ? 'Reversal completed with errors' : null,
      updatedAt: new Date(),
    },
  });

  return {
    success: errors.length === 0,
    stepsReversed,
    totalSteps,
    errors,
    reversalId: reversal.id,
  };
}

/**
 * Check if a saga can be reversed
 */
export async function canReverseSaga(sagaId: string): Promise<boolean> {
  const saga = await prisma.saga.findUnique({
    where: { id: sagaId },
  });

  if (!saga) return false;

  // Can reverse if:
  // - Status is COMPLETED or FAILED
  // - Not already REVERSING or REVERSED
  // - Not already PARTIALLY_REVERSED
  return [SAGA_STATUS.COMPLETED, SAGA_STATUS.FAILED].includes(saga.status as SagaStatus) &&
         ![SAGA_STATUS.REVERSING, SAGA_STATUS.REVERSED, SAGA_STATUS.PARTIALLY_REVERSED].includes(saga.status as SagaStatus);
}

/**
 * Get reversal status for a saga
 */
export async function getSagaReversalStatus(sagaId: string) {
  const saga = await prisma.saga.findUnique({
    where: { id: sagaId },
    include: { reversal: true },
  });

  if (!saga) {
    return { exists: false };
  }

  return {
    exists: true,
    sagaStatus: saga.status,
    reversal: saga.reversal,
    canReverse: await canReverseSaga(sagaId),
  };
}

// ============================================
// Saga Definitions
// ============================================

const sagaDefinitions: Record<string, SagaDefinition> = {};

/**
 * Register a saga definition
 */
export function registerSagaDefinition(definition: SagaDefinition) {
  sagaDefinitions[definition.sagaType] = definition;
}

/**
 * Get saga definition by type
 */
export function getSagaDefinition(sagaType: string): SagaDefinition | undefined {
  return sagaDefinitions[sagaType];
}

/**
 * Get all registered saga types
 */
export function getRegisteredSagaTypes(): string[] {
  return Object.keys(sagaDefinitions);
}

// ============================================
// Idempotency Checks
// ============================================

/**
 * Check if a saga is idempotent (can be safely retried)
 */
export async function isSagaIdempotent(sagaId: string): Promise<boolean> {
  const saga = await prisma.saga.findUnique({
    where: { id: sagaId },
    include: { steps: true },
  });

  if (!saga) return false;

  // A saga is idempotent if all its steps are idempotent
  const sagaDef = getSagaDefinition(saga.sagaType);
  if (!sagaDef) return false;

  for (const step of saga.steps) {
    const stepDef = sagaDef.steps[step.stepNumber - 1];
    if (!stepDef || !stepDef.isIdempotent) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a reversal is idempotent
 */
export async function isReversalIdempotent(reversalId: string): Promise<boolean> {
  const reversal = await prisma.sagaReversal.findUnique({
    where: { id: reversalId },
  });

  if (!reversal) return false;

  // Reversals are idempotent if the original saga steps are idempotent
  return await isSagaIdempotent(reversal.originalSagaId);
}

// ============================================
// Saga Step Management
// ============================================

/**
 * Update a saga step status
 */
export async function updateSagaStep(
  stepId: string,
  data: {
    status?: SagaStepStatus;
    result?: any;
    errorMessage?: string;
    startedAt?: Date;
    completedAt?: Date;
  }
) {
  return await prisma.sagaStep.update({
    where: { id: stepId },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });
}

/**
 * Get saga step by ID
 */
export async function getSagaStep(stepId: string) {
  return await prisma.sagaStep.findUnique({
    where: { id: stepId },
  });
}

/**
 * Get all steps for a saga
 */
export async function getSagaSteps(sagaId: string) {
  return await prisma.sagaStep.findMany({
    where: { sagaId },
    orderBy: { stepNumber: 'asc' },
  });
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get saga by ID
 */
export async function getSaga(sagaId: string) {
  return await prisma.saga.findUnique({
    where: { id: sagaId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });
}

/**
 * Get saga by transaction ID
 */
export async function getSagaByTransaction(transactionId: string) {
  return await prisma.saga.findUnique({
    where: { transactionId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });
}

/**
 * Get all sagas for a wallet
 */
export async function getSagasByWallet(walletId: string) {
  return await prisma.saga.findMany({
    where: { walletId },
    orderBy: { createdAt: 'desc' },
    include: { steps: true },
  });
}

/**
 * Clean up old completed sagas
 */
export async function cleanupOldSagas(days: number = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  return await prisma.saga.deleteMany({
    where: {
      status: { in: [SAGA_STATUS.COMPLETED, SAGA_STATUS.REVERSED, SAGA_STATUS.PARTIALLY_REVERSED] },
      completedAt: { lt: cutoffDate },
    },
  });
}

export default {
  createSaga,
  addStepsToSaga,
  executeSaga,
  reverseSaga,
  canReverseSaga,
  getSagaReversalStatus,
  registerSagaDefinition,
  getSagaDefinition,
  getRegisteredSagaTypes,
  isSagaIdempotent,
  isReversalIdempotent,
  updateSagaStep,
  getSagaStep,
  getSagaSteps,
  getSaga,
  getSagaByTransaction,
  getSagasByWallet,
  cleanupOldSagas,
};
