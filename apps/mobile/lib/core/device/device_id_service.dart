// apps/mobile/lib/core/device/device_id_service.dart
// Provides a stable device identifier used for binding device + session.

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class DeviceIdService {
  static const _deviceIdKey = 'ahava_device_id';

  final FlutterSecureStorage _secureStorage;

  DeviceIdService({FlutterSecureStorage? secureStorage})
      : _secureStorage = secureStorage ?? const FlutterSecureStorage();

  Future<String> getDeviceId() async {
    final existing = await _secureStorage.read(key: _deviceIdKey);
    if (existing != null && existing.isNotEmpty) return existing;

    final generated = const Uuid().v4();
    await _secureStorage.write(key: _deviceIdKey, value: generated);
    return generated;
  }
}
