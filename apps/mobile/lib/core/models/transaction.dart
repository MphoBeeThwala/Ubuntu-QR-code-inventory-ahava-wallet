// apps/mobile/lib/core/models/transaction.dart

class WalletTransaction {
  final String id;
  final String type; // 'DEBIT' | 'CREDIT'
  final int amountCents;
  final int balanceAfterCents;
  final String? description;
  final String status; // 'COMPLETED' | 'PENDING' | 'FAILED' | 'REVERSED'
  final String channel; // 'APP' | 'USSD' | 'QR' | 'PAYSHAP'
  final DateTime createdAt;

  WalletTransaction({
    required this.id,
    required this.type,
    required this.amountCents,
    required this.balanceAfterCents,
    this.description,
    required this.status,
    required this.channel,
    required this.createdAt,
  });

  factory WalletTransaction.fromJson(Map<String, dynamic> json) {
    return WalletTransaction(
      id: json['id'] as String,
      type: json['type'] as String,
      amountCents: (json['amountCents'] as num).toInt(),
      balanceAfterCents: (json['balanceAfter'] as num?)?.toInt() ?? 0,
      description: json['description'] as String?,
      status: (json['status'] as String?) ?? 'COMPLETED',
      channel: (json['channel'] as String?) ?? 'APP',
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  bool get isCredit => type == 'CREDIT';
  bool get isDebit => type == 'DEBIT';
  bool get isCompleted => status == 'COMPLETED';
}
