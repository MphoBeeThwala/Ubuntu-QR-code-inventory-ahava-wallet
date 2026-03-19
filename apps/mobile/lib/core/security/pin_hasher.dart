// apps/mobile/lib/core/security/pin_hasher.dart
// Client-side Argon2id hashing for PINs.

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:pointycastle/api.dart';
import 'package:pointycastle/key_derivators/argon2.dart';

class PinHasher {
  static const _saltLength = 16;
  static const _hashLength = 32;

  // Use modest memory settings for mobile devices.
  static const _memory = 1 << 12; // 4 MB
  static const _iterations = 2;
  static const _parallelism = 1;

  static Uint8List _randomBytes(int length) {
    final rnd = Random.secure();
    final bytes = List<int>.generate(length, (_) => rnd.nextInt(256));
    return Uint8List.fromList(bytes);
  }

  static String hash(String pin) {
    final salt = _randomBytes(_saltLength);
    final hash = _derive(pin, salt);

    final saltBase64 = base64UrlEncode(salt);
    final hashBase64 = base64UrlEncode(hash);

    return '$saltBase64:$hashBase64';
  }

  static bool verify(String pin, String stored) {
    final parts = stored.split(':');
    if (parts.length != 2) return false;

    final salt = base64Url.decode(parts[0]);
    final storedHash = base64Url.decode(parts[1]);
    final computed = _derive(pin, salt);

    if (computed.length != storedHash.length) return false;
    for (var i = 0; i < computed.length; i++) {
      if (computed[i] != storedHash[i]) return false;
    }
    return true;
  }

  static Uint8List _derive(String pin, Uint8List salt) {
    final params = Argon2Parameters(
      Argon2Parameters.ARGON2_id,
      salt,
      desiredKeyLength: _hashLength,
      iterations: _iterations,
      memory: _memory,
      lanes: _parallelism,
    );

    final generator = Argon2BytesGenerator();
    generator.init(params);

    final input = Uint8List.fromList(utf8.encode(pin));
    final out = Uint8List(_hashLength);
    generator.deriveKey(input, 0, out, 0);
    return out;
  }
}
