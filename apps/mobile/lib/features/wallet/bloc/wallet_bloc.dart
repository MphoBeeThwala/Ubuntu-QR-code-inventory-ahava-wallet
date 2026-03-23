// apps/mobile/lib/features/wallet/bloc/wallet_bloc.dart
// Wallet state management powered by the API.

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/models/wallet_balance.dart';
import '../../../core/models/transaction.dart';
import '../../../core/repositories/wallet_repository.dart';

// ─── Events ──────────────────────────────────────────────────────

abstract class WalletEvent {}

class WalletLoadRequested extends WalletEvent {
  final String walletId;
  WalletLoadRequested(this.walletId);
}

class TransactionHistoryRequested extends WalletEvent {
  final int limit;
  final int offset;
  TransactionHistoryRequested({this.limit = 20, this.offset = 0});
}

// ─── States ──────────────────────────────────────────────────────

abstract class WalletState {}

class WalletInitial extends WalletState {}

class WalletLoadInProgress extends WalletState {}

class WalletLoadSuccess extends WalletState {
  final WalletBalance balance;
  WalletLoadSuccess(this.balance);
}

class WalletLoadFailure extends WalletState {
  final String message;
  WalletLoadFailure(this.message);
}

class TransactionHistoryLoading extends WalletState {}

class TransactionHistoryLoaded extends WalletState {
  final List<WalletTransaction> transactions;
  final bool hasMore;
  TransactionHistoryLoaded({required this.transactions, this.hasMore = false});
}

// ─── BLoC ────────────────────────────────────────────────────────

class WalletBloc extends Bloc<WalletEvent, WalletState> {
  final WalletRepository _walletRepository;
  String? _currentWalletId;

  WalletBloc({required WalletRepository walletRepository})
      : _walletRepository = walletRepository,
        super(WalletInitial()) {
    on<WalletLoadRequested>(_onLoad);
    on<TransactionHistoryRequested>(_onLoadHistory);
  }

  Future<void> _onLoad(WalletLoadRequested event, Emitter<WalletState> emit) async {
    _currentWalletId = event.walletId;
    emit(WalletLoadInProgress());
    try {
      final balance = await _walletRepository.getBalance(event.walletId);
      emit(WalletLoadSuccess(balance));
    } catch (e) {
      emit(WalletLoadFailure(e.toString()));
    }
  }

  Future<void> _onLoadHistory(
    TransactionHistoryRequested event,
    Emitter<WalletState> emit,
  ) async {
    if (_currentWalletId == null) return;
    emit(TransactionHistoryLoading());
    try {
      final txns = await _walletRepository.getTransactionHistory(
        _currentWalletId!,
        limit: event.limit,
        offset: event.offset,
      );
      emit(TransactionHistoryLoaded(
        transactions: txns,
        hasMore: txns.length == event.limit,
      ));
    } catch (e) {
      emit(WalletLoadFailure(e.toString()));
    }
  }
}
