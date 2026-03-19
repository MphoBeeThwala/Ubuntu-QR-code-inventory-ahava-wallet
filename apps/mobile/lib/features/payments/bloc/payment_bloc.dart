// apps/mobile/lib/features/payments/bloc/payment_bloc.dart
// Payment BLoC — manages the full payment lifecycle in the Flutter app
// Offline detection → idempotency key generation → API call → success/failure state

import 'dart:async';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';

import '../../../core/errors/ahava_error.dart';
import '../../../core/repositories/payment_repository.dart';
import '../../../shared_types/payment_types.dart';

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
  final PaymentReady? previous;

  const PaymentFailure({
    required this.errorCode,
    required this.message,
    required this.isRetryable,
    this.previous,
  });

  @override
  List<Object?> get props => [errorCode, message, previous];
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
  final PaymentRepository _paymentRepository;

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

  PaymentBloc({required PaymentRepository paymentRepository})
      : _paymentRepository = paymentRepository,
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
      // NOTE: payment service will validate recipient & idempotency.
      // We still resolve local metadata for display purposes.
      // In the future, we could call a dedicated endpoint for recipient validation.
      
      // For now, continue to allow payment flow even if recipient metadata isn't resolvable.
      // (The backend will reject invalid recipients.)

      // Calculate fee client-side for display (server always recalculates — this is display only)
      final feeCents = _calculateDisplayFee(event.amountCents, event.isFamilyTransfer);
      final totalDebit = event.amountCents + feeCents;

      // Resolve recipient display name if possible
      final recipientWallet = await _paymentRepository.resolveWallet(event.recipientWalletNumber);
      final recipientName = recipientWallet?.holderName ?? 'Recipient';

      // Generate / reuse idempotency key — persists across retries for the same payment intent
      final idempotencyKey = await _paymentRepository.getOrCreatePendingIdempotencyKey(
        receiverWalletNumber: event.recipientWalletNumber,
        amountCents: event.amountCents,
        reference: event.reference,
        isFamilyTransfer: event.isFamilyTransfer,
      );

      emit(PaymentReady(
        recipientWalletNumber: event.recipientWalletNumber,
        recipientName: recipientName,
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
      final payload = await _paymentRepository.validateQrCode(event.qrPayload);

      // Resolve merchant name (legacy behavior)
      final merchant = await _paymentRepository.resolveWallet(payload.walletNumber);

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
      final result = await _paymentRepository.initiatePayment(
        receiverWalletNumber: currentState.recipientWalletNumber,
        amountCents: currentState.amountCents,
        idempotencyKey: currentState.idempotencyKey,
        reference: currentState.reference,
        isFamilyTransfer: currentState.isFamilyTransfer,
      );

      await _paymentRepository.clearPendingIdempotencyKey();
      emit(PaymentSuccess(result: result));
    } on AhavaError catch (e) {
      final isRetryable = !_nonRetryableCodes.contains(e.code);
      if (!isRetryable) {
        await _paymentRepository.clearPendingIdempotencyKey();
      }

      emit(PaymentFailure(
        errorCode: e.code,
        message: e.userMessage,
        isRetryable: isRetryable,
        previous: currentState,
      ));
    } catch (e) {
      emit(PaymentFailure(
        errorCode: 'SYS_002',
        message: 'Network error. Your payment was NOT processed. Please try again.',
        isRetryable: true,
        previous: currentState,
      ));
    }
  }

  Future<void> _onCancelled(PaymentCancelled event, Emitter<PaymentState> emit) async {
    await _paymentRepository.clearPendingIdempotencyKey();
    emit(const PaymentInitial());
  }

  Future<void> _onReset(PaymentReset event, Emitter<PaymentState> emit) async {
    await _paymentRepository.clearPendingIdempotencyKey();
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
