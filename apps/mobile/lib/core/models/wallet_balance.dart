// apps/mobile/lib/core/models/wallet_balance.dart
// Model representation of wallet balance from the API.

class WalletBalance {
  final int availableCents;
  final int pendingCents;
  final int reservedCents;
  final int totalCents;
  final String currency;

  WalletBalance({
    required this.availableCents,
    required this.pendingCents,
    required this.reservedCents,
    required this.totalCents,
    required this.currency,
  });

  factory WalletBalance.fromJson(Map<String, dynamic> json) {
    return WalletBalance(
      availableCents: (json['available'] as num).toInt(),
      pendingCents: (json['pending'] as num).toInt(),
      reservedCents: (json['reserved'] as num).toInt(),
      totalCents: (json['total'] as num).toInt(),
      currency: (json['currency'] as String?) ?? 'ZAR',
    );
  }
}
