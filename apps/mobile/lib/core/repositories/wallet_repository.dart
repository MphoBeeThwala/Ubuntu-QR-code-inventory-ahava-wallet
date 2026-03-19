// apps/mobile/lib/core/repositories/wallet_repository.dart
// Wallet-related API calls with offline caching for resilience.

import '../api/ahava_api_client.dart';
import '../cache/offline_cache.dart';
import '../models/wallet_balance.dart';

class WalletRepository {
  final AhavaApiClient _apiClient;
  final OfflineCache _cache;

  WalletRepository({required AhavaApiClient apiClient, required OfflineCache cache})
      : _apiClient = apiClient,
        _cache = cache;

  static String _cacheKey(String walletId) => 'wallet_balance:$walletId';

  Future<WalletBalance> getBalance(String walletId) async {
    try {
      final response = await _apiClient.get('/wallets/$walletId/balance');
      final data = response['data'] as Map<String, dynamic>;
      final balanceJson = data['balance'] as Map<String, dynamic>;

      // Cache result for offline use
      await _cache.set(_cacheKey(walletId), balanceJson);

      return WalletBalance.fromJson(balanceJson);
    } catch (e) {
      // Fallback to cached value when network fails
      final cached = _cache.get(_cacheKey(walletId));
      if (cached != null) {
        return WalletBalance.fromJson(cached);
      }
      rethrow;
    }
  }
}
