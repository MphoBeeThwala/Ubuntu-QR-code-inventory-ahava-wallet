// apps/mobile/lib/features/home/home_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../core/theme/ahava_theme.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/wallet/bloc/wallet_bloc.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  @override
  void initState() {
    super.initState();
    final authState = context.read<AuthBloc>().state;
    if (authState is AuthAuthenticated) {
      context.read<WalletBloc>().add(WalletLoadRequested(authState.session.walletId));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dashboard'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () {
              context.read<AuthBloc>().add(LogoutRequested());
            },
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Wallet balance', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 16),
            BlocBuilder<WalletBloc, WalletState>(
              builder: (context, state) {
                if (state is WalletLoadInProgress) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (state is WalletLoadSuccess) {
                  final balance = state.balance;
                  final formatted = (balance.availableCents / 100).toStringAsFixed(2);
                  return Card(
                    elevation: 2,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Available', style: Theme.of(context).textTheme.labelLarge),
                          const SizedBox(height: 8),
                          Text(
                            'R $formatted',
                            style: Theme.of(context)
                                .textTheme
                                .displayMedium
                                ?.copyWith(color: AhavaColors.gold500),
                          ),
                        ],
                      ),
                    ),
                  );
                }

                if (state is WalletLoadFailure) {
                  return Text('Could not load wallet: ${state.message}');
                }

                return const SizedBox.shrink();
              },
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                icon: const Icon(Icons.send),
                label: const Text('Send money'),
                onPressed: () => GoRouter.of(context).go('/payment'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
