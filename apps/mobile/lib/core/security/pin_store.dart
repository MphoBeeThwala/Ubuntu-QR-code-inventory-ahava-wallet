// apps/mobile/lib/core/security/pin_store.dart
// Stores a safely hashed PIN for quick unlock without needing the full auth flow.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class PinStore {
  static const _pinHashKey = 'ahava_pin_hash';

  final FlutterSecureStorage _storage;

  PinStore({FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  Future<void> savePinHash(String hash) async {
    await _storage.write(key: _pinHashKey, value: hash);
  }

  Future<String?> getPinHash() async {
    return _storage.read(key: _pinHashKey);
  }

  Future<void> clear() async {
    await _storage.delete(key: _pinHashKey);
  }
}
