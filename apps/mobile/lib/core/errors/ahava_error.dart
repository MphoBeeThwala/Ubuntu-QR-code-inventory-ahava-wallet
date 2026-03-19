// apps/mobile/lib/core/errors/ahava_error.dart

class AhavaError implements Exception {
  final String code;
  final String userMessage;

  AhavaError({required this.code, required this.userMessage});

  @override
  String toString() => 'AhavaError($code): $userMessage';
}
