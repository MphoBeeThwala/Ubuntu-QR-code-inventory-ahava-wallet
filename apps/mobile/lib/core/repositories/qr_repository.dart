// apps/mobile/lib/core/repositories/qr_repository.dart
// QR code API calls: lookup a QR hash and pay via QR.

import '../api/ahava_api_client.dart';

class QrInfo {
  final String qrId;
  final String qrType;
  final String walletNumber;
  final int? amountCents;
  final String currency;
  final String? description;
  final DateTime? expiresAt;

  const QrInfo({
    required this.qrId,
    required this.qrType,
    required this.walletNumber,
    this.amountCents,
    required this.currency,
    this.description,
    this.expiresAt,
  });

  factory QrInfo.fromJson(Map<String, dynamic> json) => QrInfo(
        qrId: json['qrId'] as String,
        qrType: json['qrType'] as String,
        walletNumber: json['walletNumber'] as String,
        amountCents: json['amountCents'] as int?,
        currency: (json['currency'] as String?) ?? 'ZAR',
        description: json['description'] as String?,
        expiresAt: json['expiresAt'] != null
            ? DateTime.tryParse(json['expiresAt'] as String)
            : null,
      );

  bool get isDynamic => qrType == 'DYNAMIC';
  bool get hasLockedAmount => isDynamic && amountCents != null;

  bool get isExpired {
    if (expiresAt == null) return false;
    return DateTime.now().isAfter(expiresAt!);
  }
}

class QrGenerateResult {
  final String qrId;
  final String qrHash;
  final String deepLink;
  final String qrType;
  final int? amountCents;
  final DateTime? expiresAt;

  const QrGenerateResult({
    required this.qrId,
    required this.qrHash,
    required this.deepLink,
    required this.qrType,
    this.amountCents,
    this.expiresAt,
  });

  factory QrGenerateResult.fromJson(Map<String, dynamic> json) =>
      QrGenerateResult(
        qrId: json['qrId'] as String,
        qrHash: json['qrHash'] as String,
        deepLink: json['deepLink'] as String,
        qrType: json['qrType'] as String,
        amountCents: json['amountCents'] as int?,
        expiresAt: json['expiresAt'] != null
            ? DateTime.tryParse(json['expiresAt'] as String)
            : null,
      );
}

class QrPayResult {
  final String transactionId;
  final int amountCents;

  const QrPayResult({required this.transactionId, required this.amountCents});

  factory QrPayResult.fromJson(Map<String, dynamic> json) => QrPayResult(
        transactionId: json['transactionId'] as String,
        amountCents: json['amountCents'] as int,
      );
}

class QrRepository {
  final AhavaApiClient _apiClient;

  const QrRepository({required AhavaApiClient apiClient})
      : _apiClient = apiClient;

  Future<QrGenerateResult> generateQr(
    String walletId, {
    String qrType = 'STATIC',
    int? amountCents,
    String? description,
  }) async {
    final response = await _apiClient.post(
      '/wallets/$walletId/qr',
      body: {
        'qrType': qrType,
        if (amountCents != null) 'amountCents': amountCents,
        if (description != null) 'description': description,
      },
    );
    final data = response['data'] as Map<String, dynamic>;
    return QrGenerateResult.fromJson(data);
  }

  Future<QrInfo> lookupQr(String qrHash) async {
    final response = await _apiClient.get('/qr/$qrHash');
    final data = response['data'] as Map<String, dynamic>;
    return QrInfo.fromJson(data);
  }

  Future<QrPayResult> payViaQr({
    required String qrHash,
    required String senderWalletId,
    required int amountCents,
    required String idempotencyKey,
  }) async {
    final response = await _apiClient.post('/qr/$qrHash/pay', body: {
      'senderWalletId': senderWalletId,
      'amountCents': amountCents,
      'idempotencyKey': idempotencyKey,
    });
    final data = response['data'] as Map<String, dynamic>;
    return QrPayResult.fromJson(data);
  }
}
