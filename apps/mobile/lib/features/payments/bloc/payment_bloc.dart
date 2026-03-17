// apps/mobile/lib/features/payments/bloc/payment_bloc.dart
// Payment BLoC — manages the full payment lifecycle in the Flutter app
// Offline detection → idempotency key generation → API call → success/failure state

import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:uuid/uuid.dart';

import '../../../core/api/ahava_api_client.dart';
import '../../../core/errors/ahava_error.dart';
import '../../../packages/shared-types/payment_types.dart';

// ─────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────

abstract class PaymentEvent extends Equatable {
  const PaymentEvent();
  @override
  List<Object?> get props => [];
}

class PaymentInitiated extends PaymentEvent {
  final String recipientWalletNumber;  // AHV-XXXX-XXXX
  final int amountCents;               // Integer cents — NEVER double
  final String? reference;
  final bool isFamilyTransfer;
  final String? qrCodeId;

  const PaymentInitiated({
    required this.recipientWalletNumber,
    required this.amountCents,
    this.reference,
    this.isFamilyTransfer = false,
    this.qrCodeId,
  });

  @override
  List<Object?> get props => [recipientWalletNumber, amountCents, reference, isFamilyTransfer, qrCodeId];
}

class PaymentQrScanned extends PaymentEvent {
  final String qrPayload;

  const PaymentQrScanned({required this.qrPayload});

  @override
  List<Object?> get props => [qrPayload];
}

class PaymentConfirmed extends PaymentEvent {
  const PaymentConfirmed();
}

class PaymentCancelled extends PaymentEvent {
  const PaymentCancelled();
}

class PaymentReset extends PaymentEvent {
  const PaymentReset();
}

// ─────────────────────────────────────────────────────────────────
// STATES
// ─────────────────────────────────────────────────────────────────

abstract class PaymentState extends Equatable {
  const PaymentState();
  @override
  List<Object?> get props => [];
}

class PaymentInitial extends PaymentState {
  const PaymentInitial();
}

class PaymentReady extends PaymentState {
  final String recipientWalletNumber;
  final String recipientName;
  final int amountCents;
  final int feeCents;
  final int totalDebitCents;
  final String? reference;
  final bool isFamilyTransfer;
  final String idempotencyKey;  // Generated, ready for submission

  const PaymentReady({
    required this.recipientWalletNumber,
    required this.recipientName,
    required this.amountCents,
    required this.feeCents,
    required this.totalDebitCents,
    this.reference,
    required this.isFamilyTransfer,
    required this.idempotencyKey,
  });

  String get formattedAmount => 'R ${(amountCents / 100).toStringAsFixed(2)}';
  String get formattedFee => 'R ${(feeCents / 100).toStringAsFixed(2)}';
  String get formattedTotal => 'R ${(totalDebitCents / 100).toStringAsFixed(2)}';

  @override
  List<Object?> get props => [recipientWalletNumber, amountCents, feeCents, idempotencyKey];
}

class PaymentProcessing extends PaymentState {
  const PaymentProcessing();
}

class PaymentSuccess extends PaymentState {
  final PaymentResult result;

  const PaymentSuccess({required this.result});

  @override
  List<Object?> get props => [result.transactionId];
}

class PaymentFailure extends PaymentState {
  final String errorCode;
  final String message;
  final bool isRetryable;

  const PaymentFailure({
    required this.errorCode,
    required this.message,
    required this.isRetryable,
  });

  @override
  List<Object?> get props => [errorCode, message];
}

class PaymentQrDecoded extends PaymentState {
  final QrCodePayload payload;
  final String merchantName;

  const PaymentQrDecoded({required this.payload, required this.merchantName});

  @override
  List<Object?> get props => [payload.qrId];
}

// ─────────────────────────────────────────────────────────────────
// BLOC
// ─────────────────────────────────────────────────────────────────

class PaymentBloc extends Bloc<PaymentEvent, PaymentState> {
  final AhavaApiClient _apiClient;
  static const _uuid = Uuid();

  // Non-retryable error codes — these should not show a "try again" button
  static const _nonRetryableCodes = {
    'WAL_002', // INSUFFICIENT_BALANCE
    'WAL_003', // DAILY_LIMIT_EXCEEDED
    'WAL_004', // MONTHLY_LIMIT_EXCEEDED
    'WAL_005', // MAX_BALANCE_EXCEEDED
    'WAL_006', // WALLET_SUSPENDED
    'WAL_007', // WALLET_FROZEN
    'PAY_002', // DUPLICATE_IDEMPOTENCY_KEY — already processed
    'PAY_005', // QR_EXPIRED
    'PAY_006', // QR_ALREADY_USED
    'PAY_008', // SELF_PAYMENT
    'AML_001', // SANCTIONS_MATCH
  };

  PaymentBloc({required AhavaApiClient apiClient})
      : _apiClient = apiClient,
        super(const PaymentInitial()) {
    on<PaymentInitiated>(_onInitiated);
    on<PaymentQrScanned>(_onQrScanned);
    on<PaymentConfirmed>(_onConfirmed);
    on<PaymentCancelled>(_onCancelled);
    on<PaymentReset>(_onReset);
  }

  Future<void> _onInitiated(PaymentInitiated event, Emitter<PaymentState> emit) async {
    try {
      // Resolve recipient details before showing confirmation
      final recipient = await _apiClient.resolveWallet(event.recipientWalletNumber);
      if (recipient == null) {
        emit(const PaymentFailure(
          errorCode: 'PAY_003',
          message: 'Recipient wallet not found. Check the wallet number and try again.',
          isRetryable: false,
        ));
        return;
      }

      // Calculate fee client-side for display (server always recalculates — this is display only)
      final feeCents = _calculateDisplayFee(event.amountCents, event.isFamilyTransfer);
      final totalDebit = event.amountCents + feeCents;

      // Generate idempotency key — UUID v4, generated once per payment intent
      // If user retries the SAME payment attempt, the same key must be used
      final idempotencyKey = _uuid.v4();

      emit(PaymentReady(
        recipientWalletNumber: event.recipientWalletNumber,
        recipientName: recipient.holderName,
        amountCents: event.amountCents,
        feeCents: feeCents,
        totalDebitCents: totalDebit,
        reference: event.reference,
        isFamilyTransfer: event.isFamilyTransfer,
        idempotencyKey: idempotencyKey,
      ));
    } on AhavaError catch (e) {
      emit(PaymentFailure(
        errorCode: e.code,
        message: e.userMessage,
        isRetryable: !_nonRetryableCodes.contains(e.code),
      ));
    } catch (e) {
      emit(const PaymentFailure(
        errorCode: 'SYS_001',
        message: 'Something went wrong. Please try again.',
        isRetryable: true,
      ));
    }
  }

  Future<void> _onQrScanned(PaymentQrScanned event, Emitter<PaymentState> emit) async {
    try {
      // Validate and decode QR payload
      final payload = await _apiClient.validateQrCode(event.qrPayload);

      // Resolve merchant name
      final merchant = await _apiClient.resolveWallet(payload.walletNumber);

      emit(PaymentQrDecoded(
        payload: payload,
        merchantName: merchant?.holderName ?? payload.holderName,
      ));
    } on AhavaError catch (e) {
      emit(PaymentFailure(
        errorCode: e.code,
        message: e.userMessage,
        isRetryable: e.code != 'PAY_005' && e.code != 'PAY_007',
      ));
    }
  }

  Future<void> _onConfirmed(PaymentConfirmed event, Emitter<PaymentState> emit) async {
    final currentState = state;
    if (currentState is! PaymentReady) return;

    emit(const PaymentProcessing());

    try {
      final result = await _apiClient.initiatePayment(
        InitiatePaymentRequest(
          idempotencyKey: currentState.idempotencyKey,
          recipientWalletNumber: currentState.recipientWalletNumber,
          amountCents: currentState.amountCents,
          reference: currentState.reference,
          isFamilyTransfer: currentState.isFamilyTransfer,
          paymentMethod: 'AHAVA_WALLET',
        ),
      );

      emit(PaymentSuccess(result: result));
    } on AhavaError catch (e) {
      emit(PaymentFailure(
        errorCode: e.code,
        message: e.userMessage,
        isRetryable: !_nonRetryableCodes.contains(e.code),
      ));
    } catch (e) {
      emit(const PaymentFailure(
        errorCode: 'SYS_002',
        message: 'Network error. Your payment was NOT processed. Please try again.',
        isRetryable: true,
      ));
    }
  }

  void _onCancelled(PaymentCancelled event, Emitter<PaymentState> emit) {
    emit(const PaymentInitial());
  }

  void _onReset(PaymentReset event, Emitter<PaymentState> emit) {
    emit(const PaymentInitial());
  }

  /// Client-side fee calculation for display only.
  /// Server always recalculates — never trust client fee.
  int _calculateDisplayFee(int amountCents, bool isFamilyTransfer) {
    if (isFamilyTransfer && amountCents <= 20000) return 0; // Free under R200
    if (amountCents <= 10000) return 50;    // R0.50
    if (amountCents <= 50000) return 100;   // R1.00
    return (amountCents * 0.005).round();   // 0.5%
  }
}
