// apps/mobile/lib/core/security/certificate_pinning.dart
// Placeholder certificate pinning implementation.

class CertificatePinning {
  /// Perform any setup required to enforce certificate pinning.
  ///
  /// In production this should validate the server certificate fingerprint
  /// and reject connections that do not match.
  static Future<void> initialise() async {
    // No-op for local development.
    return;
  }
}
