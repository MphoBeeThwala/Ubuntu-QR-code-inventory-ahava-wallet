import { PrismaClient } from '@prisma/client';
import { 
  FEE_TYPES, 
  FEE_STATUS,
  FEE_ACCOUNT_CODES,
  CALCULATION_METHODS,
  DEFAULT_FEES 
} from './constants/fees';

const prisma = new PrismaClient();

interface FeeCalculationInput {
  amountCents: bigint | string | number;
  feeType: string;
  walletId: string;
  userId?: string;
  transactionId: string;
  currency?: string;
  metadata?: any;
}

export async function calculateFee(input: FeeCalculationInput) {
  const amount = BigInt(input.amountCents.toString());
  const feeType = input.feeType;
  const currency = input.currency || 'ZAR';

  const config = await prisma.feeConfiguration.findUnique({
    where: { feeType: feeType as any },
  });

  let feeAmountCents: bigint;
  let calculationMethod: string;
  let description: string;

  if (config && config.isActive) {
    switch (config.calculationMethod) {
      case CALCULATION_METHODS.PERCENTAGE:
        feeAmountCents = (amount * config.baseValue) / 100n;
        if (config.minFeeCents && feeAmountCents < config.minFeeCents) {
          feeAmountCents = config.minFeeCents;
        }
        if (config.maxFeeCents && feeAmountCents > config.maxFeeCents) {
          feeAmountCents = config.maxFeeCents;
        }
        calculationMethod = CALCULATION_METHODS.PERCENTAGE;
        description = 'Fee: ' + (config.baseValue / 100n).toString() + '% of ' + amount.toString();
        break;
      case CALCULATION_METHODS.FLAT:
        feeAmountCents = config.baseValue;
        calculationMethod = CALCULATION_METHODS.FLAT;
        description = 'Flat fee: ' + config.baseValue.toString();
        break;
      default:
        feeAmountCents = 0n;
        calculationMethod = 'UNKNOWN';
        description = 'Unknown calculation method';
    }
  } else {
    switch (feeType) {
      case FEE_TYPES.TRANSACTION_FEE:
        feeAmountCents = (amount * DEFAULT_FEES.TRANSACTION_FEE_PERCENTAGE) / 100n;
        if (feeAmountCents < DEFAULT_FEES.TRANSACTION_FEE_MIN) feeAmountCents = DEFAULT_FEES.TRANSACTION_FEE_MIN;
        if (feeAmountCents > DEFAULT_FEES.TRANSACTION_FEE_MAX) feeAmountCents = DEFAULT_FEES.TRANSACTION_FEE_MAX;
        calculationMethod = CALCULATION_METHODS.PERCENTAGE;
        description = 'Default transaction fee: 1.5%';
        break;
      case FEE_TYPES.WITHDRAWAL_FEE:
        feeAmountCents = DEFAULT_FEES.WITHDRAWAL_FEE_FLAT;
        calculationMethod = CALCULATION_METHODS.FLAT;
        description = 'Default withdrawal fee: R10.00';
        break;
      case FEE_TYPES.DEPOSIT_FEE:
        feeAmountCents = 0n;
        calculationMethod = CALCULATION_METHODS.PERCENTAGE;
        description = 'Default deposit fee: 0%';
        break;
      default:
        feeAmountCents = 0n;
        calculationMethod = 'UNKNOWN';
        description = 'Unknown fee type';
    }
  }

  if (feeAmountCents < 0n) feeAmountCents = 0n;

  return { feeAmountCents, feeType, calculationMethod, description };
}

export async function recordFeeWithLedger(input: FeeCalculationInput) {
  const calculation = await calculateFee(input);
  const feeAmountCents = calculation.feeAmountCents;

  if (feeAmountCents === 0n) {
    throw new Error('Cannot record zero fee amount');
  }

  let debitAccountCode = FEE_ACCOUNT_CODES.FEE_PAYABLE;
  let creditAccountCode = FEE_ACCOUNT_CODES.PLATFORM_REVENUE;

  if (input.feeType === FEE_TYPES.AGENT_COMMISSION) {
    debitAccountCode = FEE_ACCOUNT_CODES.AGENT_COMMISSION_PAYABLE;
    creditAccountCode = FEE_ACCOUNT_CODES.FEE_INCOME;
  }

  return await prisma.$transaction(async (tx: any) => {
    const fee = await tx.fee.create({
      data: {
        transactionId: input.transactionId,
        walletId: input.walletId,
        userId: input.userId,
        feeType: input.feeType as any,
        amountCents: feeAmountCents,
        currency: input.currency || 'ZAR',
        status: 'PENDING' as any,
        description: calculation.description,
        reference: 'fee-' + input.transactionId + '-' + input.feeType,
        metadata: input.metadata,
      },
    });

    const debitEntry = await tx.ledgerEntry.create({
      data: {
        transactionId: input.transactionId + '-fee-debit',
        walletId: input.walletId,
        userId: input.userId,
        entryType: 'DEBIT' as any,
        accountCode: debitAccountCode,
        amountCents: feeAmountCents,
        currency: input.currency || 'ZAR',
        description: 'Fee DEBIT: ' + calculation.description,
        reference: fee.reference,
        counterpartyWalletId: input.walletId,
        counterpartyAccountCode: creditAccountCode,
        metadata: { feeId: fee.id, entryType: 'DEBIT' },
      },
    });

    const creditEntry = await tx.ledgerEntry.create({
      data: {
        transactionId: input.transactionId + '-fee-credit',
        walletId: 'PLATFORM_WALLET',
        userId: 'SYSTEM',
        entryType: 'CREDIT' as any,
        accountCode: creditAccountCode,
        amountCents: feeAmountCents,
        currency: input.currency || 'ZAR',
        description: 'Fee CREDIT: ' + calculation.description,
        reference: fee.reference,
        counterpartyWalletId: input.walletId,
        counterpartyAccountCode: debitAccountCode,
        metadata: { feeId: fee.id, entryType: 'CREDIT' },
      },
    });

    await tx.fee.update({
      where: { id: fee.id },
      data: {
        debitEntryId: debitEntry.id,
        creditEntryId: creditEntry.id,
        status: 'COMPLETED' as any,
      },
    });

    return { fee, debitEntry, creditEntry };
  });
}

export default { calculateFee, recordFeeWithLedger };
