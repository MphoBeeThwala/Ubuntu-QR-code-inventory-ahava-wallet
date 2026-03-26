// apps/mobile/lib/core/models/payment_receipt.dart
// Persisted payment receipt model stored locally on the device.

class PaymentReceipt {
  final String transactionId;
  final String recipientWalletNumber;
  final String recipientName;
  final int amountCents;
  final int feeCents;
  final int totalDebitedCents;
  final DateTime completedAt;
  final String? reference;

  PaymentReceipt({
    required this.transactionId,
    required this.recipientWalletNumber,
    required this.recipientName,
    required this.amountCents,
    required this.feeCents,
    required this.totalDebitedCents,
    required this.completedAt,
    this.reference,
  });

  Map<String, dynamic> toJson() {
    return {
      'transactionId': transactionId,
      'recipientWalletNumber': recipientWalletNumber,
      'recipientName': recipientName,
      'amountCents': amountCents,
      'feeCents': feeCents,
      'totalDebitedCents': totalDebitedCents,
      'completedAt': completedAt.toIso8601String(),
      'reference': reference,
    };
  }

  factory PaymentReceipt.fromJson(Map<String, dynamic> json) {
    return PaymentReceipt(
      transactionId: json['transactionId'] as String,
      recipientWalletNumber: json['recipientWalletNumber'] as String,
      recipientName: json['recipientName'] as String,
      amountCents: (json['amountCents'] as num).toInt(),
      feeCents: (json['feeCents'] as num).toInt(),
      totalDebitedCents: (json['totalDebitedCents'] as num).toInt(),
      completedAt: DateTime.parse(json['completedAt'] as String),
      reference: json['reference'] as String?,
    );
  }
}
