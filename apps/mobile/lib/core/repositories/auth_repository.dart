// apps/mobile/lib/core/repositories/auth_repository.dart
// Handles authentication flow with the Ahava API gateway.

import '../api/ahava_api_client.dart';
import '../device/device_id_service.dart';
import '../models/auth_session.dart';
import '../security/pin_hasher.dart';
import '../security/pin_store.dart';
import '../storage/token_storage.dart';

class AuthRepository {
  final AhavaApiClient _apiClient;
  final TokenStorage _tokenStorage;
  final DeviceIdService _deviceIdService;
  final PinStore _pinStore;

  AuthRepository({
    required AhavaApiClient apiClient,
    required TokenStorage tokenStorage,
    required DeviceIdService deviceIdService,
    required PinStore pinStore,
  })  : _apiClient = apiClient,
        _tokenStorage = tokenStorage,
        _deviceIdService = deviceIdService,
        _pinStore = pinStore;

  Future<AuthSession> login({
    required String phoneNumber,
    required String pin,
  }) async {
    final deviceId = await _deviceIdService.getDeviceId();

    final response = await _apiClient.post(
      '/auth/login',
      body: {
        'phoneNumber': phoneNumber.trim(),
        'pin': pin.trim(),
        'deviceId': deviceId,
        // The backend expects these, but if missing will validate.
        'deviceName': 'Flutter Mobile',
        'userAgent': '',
        'ipAddress': '',
      },
      requireAuth: false,
    );

    final data = response['data'] as Map<String, dynamic>;

    final session = AuthSession(
      userId: data['userId'] as String,
      walletId: data['walletId'] as String,
      accessToken: data['accessToken'] as String,
      refreshToken: data['refreshToken'] as String,
    );

    // Persist session for future app launches
    await _tokenStorage.saveSession(
      userId: session.userId,
      walletId: session.walletId,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    );

    // Save hashed PIN locally for lock-screen unlock
    final pinHash = PinHasher.hash(pin);
    await _pinStore.savePinHash(pinHash);

    // Ensure API client uses the new token
    _apiClient.setAccessToken(session.accessToken);

    return session;
  }

  Future<AuthSession?> restoreSession() async {
    final userId = await _tokenStorage.userId;
    final walletId = await _tokenStorage.walletId;
    final accessToken = await _tokenStorage.accessToken;
    final refreshToken = await _tokenStorage.refreshToken;

    if ([userId, walletId, accessToken, refreshToken].any((e) => e == null || e.isEmpty)) {
      return null;
    }

    final session = AuthSession(
      userId: userId!,
      walletId: walletId!,
      accessToken: accessToken!,
      refreshToken: refreshToken!,
    );

    _apiClient.setAccessToken(session.accessToken);
    return session;
  }

  Future<void> logout() async {
    final userId = await _tokenStorage.userId;
    final refreshToken = await _tokenStorage.refreshToken;
    if (userId != null && refreshToken != null) {
      try {
        await _apiClient.post(
          '/auth/logout',
          body: {
            'userId': userId,
            'refreshToken': refreshToken,
          },
          requireAuth: true,
        );
      } catch (_) {
        // ignore errors; we still want to clear local state
      }
    }

    await _tokenStorage.clearSession();
    await _pinStore.clear();
    _apiClient.setAccessToken(null);
  }
}

