import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/models/auth_session.dart';
import '../../../core/repositories/auth_repository.dart';

// Events
abstract class AuthEvent {
  const AuthEvent();
}

class LoginRequested extends AuthEvent {
  final String phone;
  final String pin;
  LoginRequested({required this.phone, required this.pin});
}

class LogoutRequested extends AuthEvent {}

class AuthCheckRequested extends AuthEvent {}

class BiometricReauthRequired extends AuthEvent {
  const BiometricReauthRequired();
}

class AuthInitialised extends AuthEvent {
  const AuthInitialised();
}

// States
abstract class AuthState {}

class AuthInitial extends AuthState {}

class AuthLoading extends AuthState {}

class AuthAuthenticated extends AuthState {
  final AuthSession session;
  AuthAuthenticated({required this.session});
}

class AuthError extends AuthState {
  final String message;
  AuthError({required this.message});
}

class AuthUnauthenticated extends AuthState {}

// BLoC
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final AuthRepository _authRepository;

  AuthBloc({required AuthRepository authRepository})
      : _authRepository = authRepository,
        super(AuthInitial()) {
    on<LoginRequested>(_onLoginRequested);
    on<LogoutRequested>(_onLogoutRequested);
    on<AuthCheckRequested>(_onAuthCheckRequested);
    on<BiometricReauthRequired>(_onBiometricReauthRequired);
    on<AuthInitialised>(_onAuthInitialised);
  }

  Future<void> _onBiometricReauthRequired(
    BiometricReauthRequired event,
    Emitter<AuthState> emit,
  ) async {
    // Placeholder: trigger re-authentication flow (e.g., show biometric modal)
    emit(AuthUnauthenticated());
  }

  Future<void> _onAuthInitialised(
    AuthInitialised event,
    Emitter<AuthState> emit,
  ) async {
    add(AuthCheckRequested());
  }

  Future<void> _onLoginRequested(
    LoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());
    try {
      final session = await _authRepository.login(
        phoneNumber: event.phone,
        pin: event.pin,
      );
      emit(AuthAuthenticated(session: session));
    } catch (e) {
      emit(AuthError(message: e.toString()));
    }
  }

  Future<void> _onLogoutRequested(
    LogoutRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());
    try {
      await _authRepository.logout();
      emit(AuthUnauthenticated());
    } catch (e) {
      emit(AuthError(message: e.toString()));
    }
  }

  Future<void> _onAuthCheckRequested(
    AuthCheckRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());
    try {
      final session = await _authRepository.restoreSession();
      if (session != null) {
        emit(AuthAuthenticated(session: session));
      } else {
        emit(AuthUnauthenticated());
      }
    } catch (e) {
      emit(AuthError(message: e.toString()));
    }
  }
}
