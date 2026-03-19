// apps/mobile/lib/core/config/app_config.dart
// App configuration for mobile (compile-time constants).

class AppConfig {
  /// Base URL for the Ahava API gateway.
  ///
  /// In local dev, this can be overridden via `--dart-define=AHAVA_API_BASE_URL=...`
  static const apiBaseUrl = String.fromEnvironment(
    'AHAVA_API_BASE_URL',
    defaultValue: 'http://localhost:6000',
  );

  /// Default timeout for HTTP calls.
  static const requestTimeoutSeconds = 30;
}
