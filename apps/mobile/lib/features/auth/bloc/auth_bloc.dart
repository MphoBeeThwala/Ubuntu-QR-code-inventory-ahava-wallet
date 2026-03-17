import 'package:flutter_bloc/flutter_bloc.dart';

// Events
abstract class AuthEvent {}

class LoginRequested extends AuthEvent {
  final String phone;
  final String pin;
  LoginRequested({required this.phone, required this.pin});
}

class LogoutRequested extends AuthEvent {}

class AuthCheckRequested extends AuthEvent {}

// States
abstract class AuthState {}

class AuthInitial extends AuthState {}

class AuthLoading extends AuthState {}

class AuthAuthenticated extends AuthState {
  final String userId;
  final String accessToken;
  AuthAuthenticated({required this.userId, required this.accessToken});
}

class AuthError extends AuthState {
  final String message;
  AuthError({required this.message});
}

class AuthUnauthenticated extends AuthState {}

// BLoC
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc() : super(AuthInitial()) {
    on<LoginRequested>(_onLoginRequested);
    on<LogoutRequested>(_onLogoutRequested);
    on<AuthCheckRequested>(_onAuthCheckRequested);
  }

  Future<void> _onLoginRequested(
    LoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(AuthLoading());
    try {
      // TODO: Call API Gateway /auth/login endpoint
      // String token = await authService.login(event.phone, event.pin);
      // emit(AuthAuthenticated(userId: '...', accessToken: token));
      
      // Mock for now
      await Future.delayed(const Duration(seconds: 2));
      emit(AuthAuthenticated(userId: 'user123', accessToken: 'token_mock'));
    } catch (e) {
      emit(AuthError(message: e.toString()));
    }
  }

  Future<void> _onLogoutRequested(
    LogoutRequested event,
    Emitter<AuthState> emit,
  ) async {
    try {
      // TODO: Call API Gateway /auth/logout endpoint
      emit(AuthUnauthenticated());
    } catch (e) {
      emit(AuthError(message: e.toString()));
    }
  }

  Future<void> _onAuthCheckRequested(
    AuthCheckRequested event,
    Emitter<AuthState> emit,
  ) async {
    try {
      // TODO: Check if token is stored locally and valid
      emit(AuthUnauthenticated());
    } catch (e) {
      emit(AuthError(message: e.toString()));
    }
  }
}
