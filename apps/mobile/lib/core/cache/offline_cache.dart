// apps/mobile/lib/core/cache/offline_cache.dart
// Simple persistent cache for offline/resilient reads.

import 'package:hive_flutter/hive_flutter.dart';

class OfflineCache {
  static const _boxName = 'offline_cache';

  /// Ensure the cache is initialized before use.
  static Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox(_boxName);
  }

  Box<dynamic> get _box => Hive.box(_boxName);

  Future<void> set(String key, Map<String, dynamic> value) async {
    await _box.put(key, value);
  }

  Map<String, dynamic>? get(String key) {
    final value = _box.get(key);
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return null;
  }

  Future<void> delete(String key) async {
    await _box.delete(key);
  }
}
