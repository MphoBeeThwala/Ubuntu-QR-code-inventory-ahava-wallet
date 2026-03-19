// apps/mobile/lib/features/notifications/bloc/notification_bloc.dart
// Minimal notification state management.

import 'package:flutter_bloc/flutter_bloc.dart';

abstract class NotificationEvent {}

class NotificationsLoadRequested extends NotificationEvent {}

abstract class NotificationState {}

class NotificationInitial extends NotificationState {}

class NotificationLoadInProgress extends NotificationState {}

class NotificationLoadSuccess extends NotificationState {
  final int unreadCount;
  NotificationLoadSuccess(this.unreadCount);
}

class NotificationLoadFailure extends NotificationState {
  final String message;
  NotificationLoadFailure(this.message);
}

class NotificationBloc extends Bloc<NotificationEvent, NotificationState> {
  NotificationBloc() : super(NotificationInitial()) {
    on<NotificationsLoadRequested>(_onLoad);
  }

  Future<void> _onLoad(NotificationsLoadRequested event, Emitter<NotificationState> emit) async {
    emit(NotificationLoadInProgress());
    await Future.delayed(const Duration(milliseconds: 200));
    emit(NotificationLoadSuccess(0));
  }
}
