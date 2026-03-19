// apps/mobile/lib/features/wallet/bloc/wallet_bloc.dart
// Wallet state management powered by the API.

import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/models/wallet_balance.dart';
import '../../../core/repositories/wallet_repository.dart';

abstract class WalletEvent {}

class WalletLoadRequested extends WalletEvent {
  final String walletId;
  WalletLoadRequested(this.walletId);
}

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

class WalletBloc extends Bloc<WalletEvent, WalletState> {
  final WalletRepository _walletRepository;

  WalletBloc({required WalletRepository walletRepository})
      : _walletRepository = walletRepository,
        super(WalletInitial()) {
    on<WalletLoadRequested>(_onLoad);
  }

  Future<void> _onLoad(WalletLoadRequested event, Emitter<WalletState> emit) async {
    emit(WalletLoadInProgress());
    try {
      final balance = await _walletRepository.getBalance(event.walletId);
      emit(WalletLoadSuccess(balance));
    } catch (e) {
      emit(WalletLoadFailure(e.toString()));
    }
  }
}
