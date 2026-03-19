// apps/mobile/lib/shared_types/payment_types.dart
// Shared type definitions used by the mobile app.

class WalletSummary {
  final String walletId;
  final String walletNumber;
  final String holderName;

  WalletSummary({
    required this.walletId,
    required this.walletNumber,
    required this.holderName,
  });
}

class QrCodePayload {
  final String qrId;
  final String walletNumber;
  final String holderName;

  QrCodePayload({required this.qrId, required this.walletNumber, required this.holderName});
}

class InitiatePaymentRequest {
  final String idempotencyKey;
  final String recipientWalletNumber;
  final int amountCents;
  final String? reference;
  final bool isFamilyTransfer;
  final String paymentMethod;

  InitiatePaymentRequest({
    required this.idempotencyKey,
    required this.recipientWalletNumber,
    required this.amountCents,
    this.reference,
    this.isFamilyTransfer = false,
    required this.paymentMethod,
  });
}

class PaymentResult {
  final String transactionId;
  final String status;
  final int amountCents;
  final int feeCents;
  final int totalDebitedCents;
  final DateTime completedAt;

  PaymentResult({
    required this.transactionId,
    required this.status,
    required this.amountCents,
    required this.feeCents,
    required this.totalDebitedCents,
    required this.completedAt,
  });
}
