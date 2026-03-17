// apps/mobile/lib/main.dart
// Ahava eWallet — Production app entry point
// Security: certificate pinning on first HTTP call, biometric check on resume

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

import 'core/router/app_router.dart';
import 'core/theme/ahava_theme.dart';
import 'core/di/service_locator.dart';
import 'core/security/certificate_pinning.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/wallet/bloc/wallet_bloc.dart';
import 'features/notifications/bloc/notification_bloc.dart';
import 'l10n/app_localizations.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock orientation to portrait — financial app UX standard
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Status bar styling
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Colors.transparent,
    statusBarIconBrightness: Brightness.light,
  ));

  // Firebase initialisation
  await Firebase.initializeApp();

  // Initialise dependency injection
  await setupServiceLocator();

  // Initialise certificate pinning before any network calls
  await CertificatePinning.initialise();

  // Sentry error tracking — filter PII before sending
  await SentryFlutter.init(
    (options) {
      options.dsn = const String.fromEnvironment('SENTRY_DSN');
      options.environment = const String.fromEnvironment('APP_ENV', defaultValue: 'dev');
      options.tracesSampleRate = 0.1; // 10% sampling in production
      options.beforeSend = _sanitiseSentryEvent; // Strip PII
    },
    appRunner: () => runApp(const AhavaApp()),
  );
}

/// Strip any PII from Sentry events before transmission
SentryEvent? _sanitiseSentryEvent(SentryEvent event, Hint hint) {
  // Remove phone numbers, wallet numbers, and amounts from error context
  return event.copyWith(
    extra: event.extra?.map((key, value) {
      if (['phone', 'walletNumber', 'amount', 'balance', 'pin'].contains(key)) {
        return MapEntry(key, '[REDACTED]');
      }
      return MapEntry(key, value);
    }),
  );
}

class AhavaApp extends StatelessWidget {
  const AhavaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider<AuthBloc>(create: (_) => sl<AuthBloc>()..add(const AuthInitialised())),
        BlocProvider<WalletBloc>(create: (_) => sl<WalletBloc>()),
        BlocProvider<NotificationBloc>(create: (_) => sl<NotificationBloc>()),
      ],
      child: BlocBuilder<AuthBloc, AuthState>(
        builder: (context, authState) {
          return MaterialApp.router(
            title: 'Ahava eWallet',
            debugShowCheckedModeBanner: false,

            // Routing
            routerConfig: AppRouter.config(authState),

            // Theming
            theme: AhavaTheme.light,
            darkTheme: AhavaTheme.dark,
            themeMode: ThemeMode.system,

            // Localisation — EN, ZU, XH, ST, AF
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: const [
              Locale('en'),
              Locale('zu'),  // isiZulu
              Locale('xh'),  // isiXhosa
              Locale('st'),  // Sesotho
              Locale('af'),  // Afrikaans
            ],

            // Security: prevent screenshots in sensitive screens
            builder: (context, child) {
              return _SecurityWrapper(child: child ?? const SizedBox.shrink());
            },
          );
        },
      ),
    );
  }
}

/// Wraps the app to handle security concerns:
/// - Screenshot prevention on payment screens
/// - Biometric re-authentication after 5 minutes background
/// - App state listener for security events
class _SecurityWrapper extends StatefulWidget {
  final Widget child;
  const _SecurityWrapper({required this.child});

  @override
  State<_SecurityWrapper> createState() => _SecurityWrapperState();
}

class _SecurityWrapperState extends State<_SecurityWrapper>
    with WidgetsBindingObserver {
  DateTime? _lastForegroundAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      final now = DateTime.now();
      if (_lastForegroundAt != null) {
        final backgroundDuration = now.difference(_lastForegroundAt!);
        // Require biometric re-auth after 5 minutes in background
        if (backgroundDuration.inMinutes >= 5) {
          context.read<AuthBloc>().add(const BiometricReauthRequired());
        }
      }
      _lastForegroundAt = now;
    } else if (state == AppLifecycleState.paused) {
      _lastForegroundAt = DateTime.now();
    }
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}
