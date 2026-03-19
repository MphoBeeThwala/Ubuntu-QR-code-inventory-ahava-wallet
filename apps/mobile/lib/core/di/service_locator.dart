// apps/mobile/lib/core/di/service_locator.dart
// Simple service locator for the Flutter app.

import 'package:get_it/get_it.dart';

import '../api/ahava_api_client.dart';
import '../cache/offline_cache.dart';
import '../device/device_id_service.dart';
import '../repositories/auth_repository.dart';
import '../repositories/payment_repository.dart';
import '../repositories/wallet_repository.dart';
import '../security/pin_store.dart';
import '../storage/token_storage.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/notifications/bloc/notification_bloc.dart';
import '../../features/payments/bloc/payment_bloc.dart';
import '../../features/wallet/bloc/wallet_bloc.dart';

final sl = GetIt.instance;

Future<void> setupServiceLocator() async {
  // Core services
  await OfflineCache.init();
  sl.registerLazySingleton<OfflineCache>(() => OfflineCache());
  sl.registerLazySingleton<TokenStorage>(() => TokenStorage());
  sl.registerLazySingleton<PinStore>(() => PinStore());
  sl.registerLazySingleton<DeviceIdService>(() => DeviceIdService());
  sl.registerLazySingleton<AhavaApiClient>(() => AhavaApiClient());

  // Repositories
  sl.registerLazySingleton<AuthRepository>(
    () => AuthRepository(
      apiClient: sl<AhavaApiClient>(),
      tokenStorage: sl<TokenStorage>(),
      deviceIdService: sl<DeviceIdService>(),
    ),
  );

  sl.registerLazySingleton<WalletRepository>(
    () => WalletRepository(
      apiClient: sl<AhavaApiClient>(),
      cache: sl<OfflineCache>(),
    ),
  );

  sl.registerLazySingleton<PaymentRepository>(
    () => PaymentRepository(
      apiClient: sl<AhavaApiClient>(),
      deviceIdService: sl<DeviceIdService>(),
      tokenStorage: sl<TokenStorage>(),
      cache: sl<OfflineCache>(),
    ),
  );

  // Feature blocs
  sl.registerFactory<AuthBloc>(() => AuthBloc(authRepository: sl<AuthRepository>()));
  sl.registerFactory<WalletBloc>(() => WalletBloc(walletRepository: sl<WalletRepository>()));
  sl.registerFactory<PaymentBloc>(() => PaymentBloc(paymentRepository: sl<PaymentRepository>()));
  sl.registerFactory<NotificationBloc>(() => NotificationBloc());
}
