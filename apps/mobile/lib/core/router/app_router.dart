// apps/mobile/lib/core/router/app_router.dart
// Application routing (GoRouter) used by the main app.

import 'package:go_router/go_router.dart';

import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/home/home_screen.dart';

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
      ],
      redirect: (context, state) {
        final goingToLogin = state.uri.toString() == '/login';
        if (loggedIn && goingToLogin) return '/home';
        if (!loggedIn && !goingToLogin) return '/login';
        return null;
      },
    );
  }

}
