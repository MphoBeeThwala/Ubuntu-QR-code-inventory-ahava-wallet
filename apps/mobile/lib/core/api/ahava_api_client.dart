// apps/mobile/lib/core/api/ahava_api_client.dart
// Simplified HTTP client for communicating with the Ahava API gateway.

import 'dart:async';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../errors/ahava_error.dart';
import '../../shared_types/payment_types.dart';

/// Throws [AhavaError] for known API error responses.
class AhavaApiClient {
  final Dio _dio;

  /// When set, is used as Bearer token on all requests.
  String? _accessToken;

  /// Max retry attempts for transient network failures.
  static const _maxRetries = 3;

  /// Base delay between retries (ms).
  static const _retryDelayMs = 500;

  AhavaApiClient({String? baseUrl})
      : _dio = Dio(BaseOptions(
          baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
          connectTimeout: Duration(seconds: AppConfig.requestTimeoutSeconds),
          receiveTimeout: Duration(seconds: AppConfig.requestTimeoutSeconds),
          headers: {
            'Content-Type': 'application/json',
          },
        )) {
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        if (_accessToken != null && _accessToken!.isNotEmpty) {
          options.headers['Authorization'] = 'Bearer $_accessToken';
        }
        handler.next(options);
      },
    ));
  }

  void setAccessToken(String? token) {
    _accessToken = token;
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    bool requireAuth = true,
  }) async {
    return _retry<Map<String, dynamic>>(() async {
      final response = await _dio.post(path, data: body);
      return _validateResponse(response);
    });
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    bool requireAuth = true,
  }) async {
    return _retry<Map<String, dynamic>>(() async {
      final response = await _dio.get(path, queryParameters: queryParameters);
      return _validateResponse(response);
    });
  }

  Future<T> _retry<T>(Future<T> Function() fn) async {
    int attempt = 0;
    while (true) {
      try {
        return await fn();
      } on AhavaError {
        rethrow;
      } on DioException catch (e) {
        if (!_shouldRetry(e) || attempt >= _maxRetries) {
          throw _mapDioError(e);
        }
        final delayMs = _retryDelayMs * (1 << attempt);
        await Future.delayed(Duration(milliseconds: delayMs));
        attempt += 1;
      } catch (e) {
        throw AhavaError(code: 'API_UNKNOWN', userMessage: e.toString());
      }
    }
  }

  bool _shouldRetry(DioException error) {
    return error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.connectionError ||
        error.type == DioExceptionType.unknown;
  }

  Map<String, dynamic> _validateResponse(Response response) {
    if (response.data is Map<String, dynamic>) {
      final body = response.data as Map<String, dynamic>;

      // Expected Ahava response wrapper
      if (body['success'] == true && body.containsKey('data')) {
        return body;
      }

      if (body['success'] == false && body.containsKey('error')) {
        final err = body['error'] as Map<String, dynamic>;
        throw AhavaError(
          code: err['code'] as String? ?? 'API_ERROR',
          userMessage: err['message'] as String? ?? 'Unknown error',
        );
      }

      // Fallback: return whatever we got
      return body;
    }

    throw AhavaError(code: 'API_UNEXPECTED', userMessage: 'Invalid server response');
  }

  AhavaError _mapDioError(DioException error) {
    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout) {
      return AhavaError(code: 'API_TIMEOUT', userMessage: 'Request timed out');
    }

    if (error.response != null && error.response?.data is Map<String, dynamic>) {
      final body = error.response?.data as Map<String, dynamic>;
      if (body['success'] == false && body.containsKey('error')) {
        final err = body['error'] as Map<String, dynamic>;
        return AhavaError(
          code: (err['code'] as String?) ?? 'API_ERROR',
          userMessage: (err['message'] as String?) ?? 'Unknown error',
        );
      }
    }

    return AhavaError(
      code: 'API_UNKNOWN',
      userMessage: error.message ?? 'Unknown API error',
    );
  }

  // --- Legacy mocks used by Payment feature until a payment service exists ---
  Future<WalletSummary?> resolveWallet(String walletNumber) async {
    if (walletNumber.isEmpty) return null;

    final response = await get(
      '/wallets/lookup',
      queryParameters: {'walletNumber': walletNumber},
    );

    final data = response['data'] as Map<String, dynamic>?;
    if (data == null || data['wallet'] == null) return null;

    final wallet = data['wallet'] as Map<String, dynamic>;
    return WalletSummary(
      walletId: wallet['id'] as String,
      walletNumber: wallet['walletNumber'] as String,
      holderName: wallet['holderName'] as String,
    );
  }

  Future<QrCodePayload> validateQrCode(String qrPayload) async {
    await Future.delayed(const Duration(milliseconds: 250));
    if (qrPayload.isEmpty) {
      throw AhavaError(code: 'PAY_007', userMessage: 'Invalid QR code');
    }
    return QrCodePayload(qrId: qrPayload, walletNumber: 'AHV-1234-5678', holderName: 'Merchant');
  }

  Future<PaymentResult> initiatePayment(InitiatePaymentRequest request) async {
    await Future.delayed(const Duration(seconds: 1));
    return PaymentResult(
      transactionId: 'txn-${DateTime.now().millisecondsSinceEpoch}',
      status: 'COMPLETED',
      amountCents: request.amountCents,
      feeCents: 0,
      totalDebitedCents: request.amountCents,
      completedAt: DateTime.now(),
    );
  }
}

