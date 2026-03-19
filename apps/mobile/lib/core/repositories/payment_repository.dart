// apps/mobile/lib/core/repositories/payment_repository.dart
// Handles payment calls to the Ahava API.

import 'package:uuid/uuid.dart';

import '../api/ahava_api_client.dart';
import '../cache/offline_cache.dart';
import '../device/device_id_service.dart';
import '../models/auth_session.dart';
import '../storage/token_storage.dart';
import '../../shared_types/payment_types.dart';

class PaymentRepository {
  static const _pendingPaymentCacheKey = 'payment.pending';

  final AhavaApiClient _apiClient;
  final DeviceIdService _deviceIdService;
  final TokenStorage _tokenStorage;
  final OfflineCache _cache;
  final Uuid _uuid;

  PaymentRepository({
    required AhavaApiClient apiClient,
    required DeviceIdService deviceIdService,
    required TokenStorage tokenStorage,
    required OfflineCache cache,
  })  : _apiClient = apiClient,
        _deviceIdService = deviceIdService,
        _tokenStorage = tokenStorage,
        _cache = cache,
        _uuid = const Uuid();

  Future<PaymentResult> initiatePayment({
    required String receiverWalletNumber,
    required int amountCents,
    required String idempotencyKey,
    String? reference,
    bool isFamilyTransfer = false,
  }) async {
    final deviceId = await _deviceIdService.getDeviceId();
    final session = await _restoreSession();

    final actualSender = session?.walletId;
    if (actualSender == null) {
      throw Exception('No sender wallet available for payment');
    }

    final receiverWallet = await resolveWallet(receiverWalletNumber);
    if (receiverWallet == null) {
      throw Exception('Unable to resolve recipient wallet ID');
    }

    final body = {
      'senderWalletId': actualSender,
      'receiverWalletId': receiverWallet.walletId,
      'amountCents': amountCents,
      'description': reference ?? '',
      'idempotencyKey': idempotencyKey,
      'paymentMethod': 'AHAVA_WALLET',
      'deviceId': deviceId,
      'ipAddress': '',
    };

    final response = await _apiClient.post('/payments', body: body);
    final data = response['data'] as Map<String, dynamic>;
    final transaction = data['transaction'] as Map<String, dynamic>;
    final debit = transaction['debit'] as Map<String, dynamic>;

    return PaymentResult(
      transactionId: debit['id'] as String,
      status: debit['status'] as String,
      amountCents: (debit['amount'] as num).toInt(),
      feeCents: (debit['feeAmount'] as num).toInt(),
      totalDebitedCents: (debit['amount'] as num).toInt(),
      completedAt: DateTime.parse(debit['createdAt'] as String),
    );
  }

  Future<String> getOrCreatePendingIdempotencyKey({
    required String receiverWalletNumber,
    required int amountCents,
    String? reference,
    bool isFamilyTransfer = false,
  }) async {
    final cached = _cache.get(_pendingPaymentCacheKey);
    if (cached != null && cached['idempotencyKey'] is String) {
      final cachedReceiver = cached['receiverWalletNumber'] as String?;
      final cachedAmount = cached['amountCents'] as int?;
      final cachedReference = cached['reference'] as String?;
      final cachedFamily = cached['isFamilyTransfer'] as bool?;

      if (cachedReceiver == receiverWalletNumber &&
          cachedAmount == amountCents &&
          cachedReference == reference &&
          cachedFamily == isFamilyTransfer) {
        return cached['idempotencyKey'] as String;
      }
    }

    final idempotencyKey = _uuid.v4();
    await _cache.set(_pendingPaymentCacheKey, {
      'idempotencyKey': idempotencyKey,
      'receiverWalletNumber': receiverWalletNumber,
      'amountCents': amountCents,
      'reference': reference,
      'isFamilyTransfer': isFamilyTransfer,
      'createdAt': DateTime.now().toIso8601String(),
    });
    return idempotencyKey;
  }

  Future<void> clearPendingIdempotencyKey() async {
    await _cache.delete(_pendingPaymentCacheKey);
  }

  Future<QrCodePayload> validateQrCode(String qrPayload) async {
    return _apiClient.validateQrCode(qrPayload);
  }

  Future<WalletSummary?> resolveWallet(String walletNumber) async {
    return _apiClient.resolveWallet(walletNumber);
  }

  Future<AuthSession?> _restoreSession() async {
    final userId = await _tokenStorage.userId;
    final walletId = await _tokenStorage.walletId;
    final accessToken = await _tokenStorage.accessToken;
    final refreshToken = await _tokenStorage.refreshToken;

    if ([userId, walletId, accessToken, refreshToken].any((e) => e == null || e.isEmpty)) {
      return null;
    }

    return AuthSession(
      userId: userId!,
      walletId: walletId!,
      accessToken: accessToken!,
      refreshToken: refreshToken!,
    );
  }
}
