// apps/mobile/lib/core/models/auth_session.dart
// Represents a logged-in session.

class AuthSession {
  final String userId;
  final String walletId;
  final String accessToken;
  final String refreshToken;

  AuthSession({
    required this.userId,
    required this.walletId,
    required this.accessToken,
    required this.refreshToken,
  });
}
