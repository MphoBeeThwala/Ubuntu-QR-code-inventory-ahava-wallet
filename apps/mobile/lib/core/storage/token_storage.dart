// apps/mobile/lib/core/storage/token_storage.dart
// Secure token storage for the mobile app.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenStorage {
  static const _accessTokenKey = 'ahava_access_token';
  static const _refreshTokenKey = 'ahava_refresh_token';
  static const _userIdKey = 'ahava_user_id';
  static const _walletIdKey = 'ahava_wallet_id';

  final FlutterSecureStorage _secureStorage;

  TokenStorage({FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  Future<void> saveSession({
    required String userId,
    required String walletId,
    required String accessToken,
    required String refreshToken,
  }) async {
    await Future.wait([
      _secureStorage.write(key: _userIdKey, value: userId),
      _secureStorage.write(key: _walletIdKey, value: walletId),
      _secureStorage.write(key: _accessTokenKey, value: accessToken),
      _secureStorage.write(key: _refreshTokenKey, value: refreshToken),
    ]);
  }

  Future<void> clearSession() async {
    await Future.wait([
      _secureStorage.delete(key: _userIdKey),
      _secureStorage.delete(key: _walletIdKey),
      _secureStorage.delete(key: _accessTokenKey),
      _secureStorage.delete(key: _refreshTokenKey),
    ]);
  }

  Future<String?> get accessToken async =>
      await _secureStorage.read(key: _accessTokenKey);

  Future<String?> get refreshToken async =>
      await _secureStorage.read(key: _refreshTokenKey);

  Future<String?> get userId async =>
      await _secureStorage.read(key: _userIdKey);

  Future<String?> get walletId async =>
      await _secureStorage.read(key: _walletIdKey);
}
