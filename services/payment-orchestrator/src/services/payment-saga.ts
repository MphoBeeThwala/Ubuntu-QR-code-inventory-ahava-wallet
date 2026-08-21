import { PrismaClient, SagaStatus, SagaStepStatus, EntryType } from '@prisma/client';
import { 
  SAGA_TYPES, 
  SAGA_STATUS, 
  SAGA_STEP_STATUS,
  registerSagaDefinition
} from './constants/saga-types';
import { 
  recordFeeWithLedger,
  reverseFee 
} from '../../payment-service/src/services/fee-calculator';
import { 
  createSaga,
  addStepsToSaga,
  executeSaga,
  reverseSaga,
  getSaga,
  updateSagaStep
} from './saga-reversal';

const prisma = new PrismaClient();

/**
 * Payment Saga Implementation (BATCH 5)
 * 
 * Demonstrates saga pattern with reversal capabilities:
 * 1. Reserve Funds
 * 2. Create Ledger Entry (DEBIT)
 * 3. Process Payment
 * 4. Create Ledger Entry (CREDIT)
 * 5. Update Wallet Balance
 * 
 * Each step has a corresponding compensation action
 */

// ============================================
// Payment Saga Definition
// ============================================

const paymentSagaDefinition = {
  sagaType: SAGA_TYPES.PAYMENT,
  steps: [
    {
      stepType: 'RESERVE_FUNDS',
      action: 'Reserve funds in wallet',
      execute: reserveFunds,
      compensate: releaseFunds,
      isIdempotent: true,
    },
    {
      stepType: 'CREATE_DEBIT_ENTRY',
      action: 'Create DEBIT ledger entry',
      execute: createDebitEntry,
      compensate: reverseLedgerEntry,
      isIdempotent: true,
    },
    {
      stepType: 'PROCESS_PAYMENT',
      action: 'Process payment with PayShap',
      execute: processPayment,
      compensate: reversePayment,
      isIdempotent: false,
    },
    {
      stepType: 'CREATE_CREDIT_ENTRY',
      action: 'Create CREDIT ledger entry',
      execute: createCreditEntry,
      compensate: reverseLedgerEntry,
      isIdempotent: true,
    },
    {
      stepType: 'UPDATE_BALANCE',
      action: 'Update wallet balance',
      execute: updateWalletBalance,
      compensate: revertWalletBalance,
      isIdempotent: true,
    },
    {
      stepType: 'RECORD_FEE',
      action: 'Record transaction fee',
      execute: recordTransactionFee,
      compensate: reverseTransactionFee,
      isIdempotent: true,
    },
  ],
};

// Register the payment saga definition
registerSagaDefinition(paymentSagaDefinition);

// ============================================
// Step Execution Functions
// ============================================

/**
 * Step 1: Reserve funds in wallet
 */
async function reserveFunds(saga: any, step: any) {
  const { walletId, amountCents, transactionId } = saga.metadata || {};
  
  if (!walletId || !amountCents) {
    throw new Error('Missing walletId or amountCents in saga metadata');
  }

  // In a real implementation, this would update the wallet to reserve funds
  // For now, we'll just create a ledger entry to track the reservation
  const reservationEntry = await prisma.ledgerEntry.create({
    data: {
      transactionId: transactionId + '-reservation',
      walletId,
      userId: saga.userId,
      entryType: EntryType.DEBIT,
      accountCode: 'RESERVED_FUNDS',
      amountCents: BigInt(amountCents.toString()),
      currency: 'ZAR',
      description: 'Funds reserved for payment: ' + transactionId,
      reference: 'reservation-' + transactionId,
      metadata: { sagaId: saga.id, stepId: step.id },
    },
  });

  // Update step with reservation ID
  await updateSagaStep(step.id, {
    result: { reservationId: reservationEntry.id },
  });

  return { reservationId: reservationEntry.id };
}

/**
 * Compensation for Step 1: Release reserved funds
 */
async function releaseFunds(saga: any, step: any) {
  const result = step.result as any;
  const reservationId = result?.reservationId;
  
  if (!reservationId) {
    console.log('No reservation to release for step:', step.id);
    return;
  }

  // In a real implementation, this would release the reserved funds
  // For now, we'll create a reversing ledger entry
  await prisma.ledgerEntry.create({
    data: {
      transactionId: saga.transactionId + '-release',
      walletId: saga.walletId,
      userId: saga.userId,
      entryType: EntryType.CREDIT,
      accountCode: 'RESERVED_FUNDS',
      amountCents: (step.result as any)?.amountCents || 0n,
      currency: 'ZAR',
      description: 'Funds released (saga reversal): ' + saga.transactionId,
      reference: 'release-' + reservationId,
      metadata: { sagaId: saga.id, stepId: step.id, originalReservationId: reservationId },
    },
  });
}

/**
 * Step 2: Create DEBIT ledger entry
 */
async function createDebitEntry(saga: any, step: any) {
  const { walletId, amountCents, transactionId, counterpartyWalletId } = saga.metadata || {};
  
  if (!walletId || !amountCents || !counterpartyWalletId) {
    throw new Error('Missing required metadata for DEBIT entry');
  }

  const debitEntry = await prisma.ledgerEntry.create({
    data: {
      transactionId: transactionId + '-debit',
      walletId,
      userId: saga.userId,
      entryType: EntryType.DEBIT,
      accountCode: 'WALLET',
      amountCents: BigInt(amountCents.toString()),
      currency: 'ZAR',
      description: 'Payment DEBIT: ' + transactionId,
      reference: saga.transactionId,
      counterpartyWalletId,
      counterpartyAccountCode: 'WALLET',
      metadata: { sagaId: saga.id, stepId: step.id },
    },
  });

  await updateSagaStep(step.id, {
    result: { entryId: debitEntry.id },
  });

  return { entryId: debitEntry.id };
}

/**
 * Compensation for Step 2: Reverse DEBIT ledger entry
 */
async function reverseLedgerEntry(saga: any, step: any) {
  const result = step.result as any;
  const entryId = result?.entryId;
  
  if (!entryId) {
    console.log('No ledger entry to reverse for step:', step.id);
    return;
  }

  const originalEntry = await prisma.ledgerEntry.findUnique({
    where: { id: entryId },
  });

  if (!originalEntry) {
    console.log('Original ledger entry not found:', entryId);
    return;
  }

  // Create reversing entry
  const reverseEntryType = originalEntry.entryType === EntryType.DEBIT ? EntryType.CREDIT : EntryType.DEBIT;
  
  await prisma.ledgerEntry.create({
    data: {
      transactionId: saga.transactionId + '-reverse-debit',
      walletId: originalEntry.walletId,
      userId: originalEntry.userId,
      entryType: reverseEntryType,
      accountCode: originalEntry.accountCode,
      amountCents: originalEntry.amountCents,
      currency: originalEntry.currency,
      description: 'Reversal: ' + originalEntry.description,
      reference: 'reversal-' + originalEntry.reference,
      counterpartyWalletId: originalEntry.counterpartyWalletId,
      counterpartyAccountCode: originalEntry.counterpartyAccountCode,
      metadata: { 
        sagaId: saga.id, 
        stepId: step.id, 
        originalEntryId: entryId,
        isReversal: true
      },
    },
  });
}

/**
 * Step 3: Process payment with PayShap
 */
async function processPayment(saga: any, step: any) {
  const { transactionId, amountCents } = saga.metadata || {};
  
  if (!transactionId || !amountCents) {
    throw new Error('Missing transactionId or amountCents');
  }

  // In a real implementation, this would call PayShap API
  // For now, we'll simulate a successful payment
  // Note: This step is NOT idempotent (external API call)
  
  return {
    paymentReference: 'PS-' + Math.random().toString(36).substring(2, 10),
    status: 'PROCESSED',
    amountCents: BigInt(amountCents.toString()),
  };
}

/**
 * Compensation for Step 3: Reverse payment with PayShap
 */
async function reversePayment(saga: any, step: any) {
  const result = step.result as any;
  const paymentReference = result?.paymentReference;
  
  if (!paymentReference) {
    console.log('No payment reference to reverse for step:', step.id);
    return;
  }

  // In a real implementation, this would call PayShap reversal API
  // For now, we'll just log it
  console.log('Reversing payment:', paymentReference);
  
  // Simulate reversal response
  return {
    reversalReference: 'REV-' + paymentReference,
    status: 'REVERSED',
  };
}

/**
 * Step 4: Create CREDIT ledger entry
 */
async function createCreditEntry(saga: any, step: any) {
  const { walletId, amountCents, transactionId, counterpartyWalletId } = saga.metadata || {};
  
  if (!walletId || !amountCents || !counterpartyWalletId) {
    throw new Error('Missing required metadata for CREDIT entry');
  }

  const creditEntry = await prisma.ledgerEntry.create({
    data: {
      transactionId: transactionId + '-credit',
      walletId: counterpartyWalletId,
      userId: saga.userId,
      entryType: EntryType.CREDIT,
      accountCode: 'WALLET',
      amountCents: BigInt(amountCents.toString()),
      currency: 'ZAR',
      description: 'Payment CREDIT: ' + transactionId,
      reference: saga.transactionId,
      counterpartyWalletId: walletId,
      counterpartyAccountCode: 'WALLET',
      metadata: { sagaId: saga.id, stepId: step.id },
    },
  });

  await updateSagaStep(step.id, {
    result: { entryId: creditEntry.id },
  });

  return { entryId: creditEntry.id };
}

/**
 * Step 5: Update wallet balance
 */
async function updateWalletBalance(saga: any, step: any) {
  const { walletId, amountCents, transactionId } = saga.metadata || {};
  
  if (!walletId || !amountCents) {
    throw new Error('Missing walletId or amountCents');
  }

  // In a real implementation, this would update the wallet balance
  // For now, we'll just record that it happened
  
  return {
    walletId,
    oldBalance: 100000n, // Example old balance
    newBalance: 100000n - BigInt(amountCents.toString()),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Compensation for Step 5: Revert wallet balance
 */
async function revertWalletBalance(saga: any, step: any) {
  const result = step.result as any;
  const walletId = result?.walletId;
  const oldBalance = result?.oldBalance;
  
  if (!walletId || oldBalance === undefined) {
    console.log('Cannot revert wallet balance for step:', step.id);
    return;
  }

  // In a real implementation, this would restore the old balance
  console.log('Reverting wallet balance for', walletId, 'to', oldBalance.toString());
}

/**
 * Step 6: Record transaction fee
 */
async function recordTransactionFee(saga: any, step: any) {
  const { walletId, amountCents, transactionId } = saga.metadata || {};
  
  if (!walletId || !amountCents) {
    throw new Error('Missing walletId or amountCents');
  }

  // Use the fee calculator from BATCH 4
  const feeResult = await recordFeeWithLedger({
    amountCents,
    feeType: 'TRANSACTION_FEE',
    walletId,
    userId: saga.userId,
    transactionId,
    metadata: { sagaId: saga.id },
  });

  await updateSagaStep(step.id, {
    result: { feeId: feeResult.fee.id },
  });

  return { feeId: feeResult.fee.id };
}

/**
 * Compensation for Step 6: Reverse transaction fee
 */
async function reverseTransactionFee(saga: any, step: any) {
  const result = step.result as any;
  const feeId = result?.feeId;
  
  if (!feeId) {
    console.log('No fee to reverse for step:', step.id);
    return;
  }

  // Use the fee calculator from BATCH 4
  await reverseFee(feeId, 'Saga reversal');
}

// ============================================
// Public API
// ============================================

/**
 * Start a new payment saga
 */
export async function startPaymentSaga(input: {
  transactionId: string;
  walletId: string;
  userId?: string;
  amountCents: bigint | string | number;
  counterpartyWalletId: string;
  metadata?: any;
}) {
  // Create the saga
  const saga = await createSaga({
    sagaType: SAGA_TYPES.PAYMENT,
    transactionId: input.transactionId,
    walletId: input.walletId,
    userId: input.userId,
    metadata: {
      ...input.metadata,
      amountCents: input.amountCents,
      counterpartyWalletId: input.counterpartyWalletId,
    },
  });

  // Add steps from the definition
  await addStepsToSaga(saga.id, paymentSagaDefinition.steps);

  // Execute the saga
  return executeSaga(saga.id);
}

/**
 * Reverse a payment saga
 */
export async function reversePaymentSaga(sagaId: string, reason?: string) {
  return reverseSaga(sagaId, reason);
}

/**
 * Get payment saga status
 */
export async function getPaymentSagaStatus(transactionId: string) {
  const saga = await getSagaByTransaction(transactionId);
  
  if (!saga) {
    return { exists: false };
  }

  return {
    exists: true,
    saga,
    canReverse: await canReverseSaga(saga.id),
  };
}

/**
 * Get saga by transaction ID
 */
async function getSagaByTransaction(transactionId: string) {
  return await prisma.saga.findUnique({
    where: { transactionId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  });
}

/**
 * Helper to import from saga-reversal
 */
import { canReverseSaga } from './saga-reversal';

export default {
  startPaymentSaga,
  reversePaymentSaga,
  getPaymentSagaStatus,
  paymentSagaDefinition,
};
