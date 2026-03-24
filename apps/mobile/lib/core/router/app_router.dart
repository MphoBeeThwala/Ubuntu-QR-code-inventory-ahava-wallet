// apps/mobile/lib/core/router/app_router.dart
// Application routing (GoRouter) used by the main app.

import 'package:go_router/go_router.dart';

import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/payments/screens/payment_screen.dart';
import '../../features/wallet/screens/transaction_history_screen.dart';
import '../../features/wallet/screens/qr_scan_screen.dart';
import '../../features/wallet/screens/my_qr_screen.dart';
import '../../features/settings/settings_screen.dart';

/// Provides the router configuration based on auth state.
class AppRouter {
  static GoRouter config(AuthState authState) {
    final loggedIn = authState is AuthAuthenticated;

    return GoRouter(
      initialLocation: loggedIn ? '/home' : '/login',
      routes: [
        GoRoute(
          path: '/login',
          builder: (context, state) => const LoginScreen(),
        ),
        GoRoute(
          path: '/home',
          builder: (context, state) => const HomeScreen(),
        ),
        GoRoute(
          path: '/payment',
          builder: (context, state) => const PaymentScreen(),
        ),
        GoRoute(
          path: '/history',
          builder: (context, state) => const TransactionHistoryScreen(),
        ),
        GoRoute(
          path: '/scan',
          builder: (context, state) => const QrScanScreen(),
        ),
        GoRoute(
          path: '/qr',
          builder: (context, state) => const MyQrScreen(),
        ),
        GoRoute(
          path: '/settings',
          builder: (context, state) => const SettingsScreen(),
        ),
      ],
      redirect: (context, state) {
        final path = state.uri.toString();
        final goingToLogin = path == '/login';
        if (loggedIn && goingToLogin) return '/home';
        if (!loggedIn && !goingToLogin) return '/login';
        return null;
      },
    );
  }
}
