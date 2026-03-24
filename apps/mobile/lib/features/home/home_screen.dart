// apps/mobile/lib/features/home/home_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/ahava_theme.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/wallet/bloc/wallet_bloc.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _balanceVisible = true;
  int _selectedTab = 0;

  static const _tabs = [
    _TabItem(icon: Icons.home_outlined, activeIcon: Icons.home, label: 'Home'),
    _TabItem(icon: Icons.swap_horiz_outlined, activeIcon: Icons.swap_horiz, label: 'Send'),
    _TabItem(icon: Icons.qr_code_scanner_outlined, activeIcon: Icons.qr_code_scanner, label: 'Scan'),
    _TabItem(icon: Icons.receipt_long_outlined, activeIcon: Icons.receipt_long, label: 'History'),
    _TabItem(icon: Icons.settings_outlined, activeIcon: Icons.settings, label: 'Settings'),
  ];

  @override
  void initState() {
    super.initState();
    final authState = context.read<AuthBloc>().state;
    if (authState is AuthAuthenticated) {
      context.read<WalletBloc>().add(WalletLoadRequested(authState.session.walletId));
    }
  }

  void _onTabTapped(int index) {
    switch (index) {
      case 1: context.go('/payment'); return;
      case 2: context.go('/scan'); return;
      case 3: context.go('/history'); return;
      case 4: context.go('/settings'); return;
      default: setState(() => _selectedTab = 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      body: CustomScrollView(
        slivers: [
          _buildHeader(context),
          SliverToBoxAdapter(child: _buildBalanceCard(context)),
          SliverToBoxAdapter(child: _buildQuickActions(context)),
          SliverToBoxAdapter(child: _buildRecentTransactionsHeader(context)),
          _buildRecentTransactions(),
          const SliverToBoxAdapter(child: SizedBox(height: 80)),
        ],
      ),
      bottomNavigationBar: _buildBottomNav(),
    );
  }

  Widget _buildHeader(BuildContext context) {
    return SliverAppBar(
      expandedHeight: 120,
      floating: false,
      pinned: true,
      backgroundColor: AhavaColors.navy800,
      foregroundColor: Colors.white,
      automaticallyImplyLeading: false,
      flexibleSpace: FlexibleSpaceBar(
        background: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AhavaColors.navy800, AhavaColors.navy700],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          padding: const EdgeInsets.fromLTRB(20, 52, 20, 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  BlocBuilder<AuthBloc, AuthState>(
                    builder: (context, state) {
                      final greeting = _greeting();
                      return Text(
                        greeting,
                        style: const TextStyle(color: Colors.white70, fontSize: 13),
                      );
                    },
                  ),
                  const Text(
                    'Ahava Wallet',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.notifications_outlined, color: Colors.white70),
                onPressed: () {},
              ),
            ],
          ),
        ),
        title: const Text('Ahava Wallet', style: TextStyle(fontSize: 16)),
        titlePadding: const EdgeInsets.only(left: 20, bottom: 12),
        collapseMode: CollapseMode.fade,
      ),
    );
  }

  Widget _buildBalanceCard(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
      child: BlocBuilder<WalletBloc, WalletState>(
        builder: (context, state) {
          final isLoading = state is WalletLoadInProgress;
          int availableCents = 0;
          int pendingCents = 0;

          if (state is WalletLoadSuccess) {
            availableCents = state.balance.availableCents;
            pendingCents = state.balance.pendingCents;
          }

          return Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AhavaColors.navy800, AhavaColors.navy700],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(20),
              boxShadow: [
                BoxShadow(
                  color: AhavaColors.navy900.withOpacity(0.3),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Available Balance',
                      style: TextStyle(color: Colors.white60, fontSize: 13),
                    ),
                    GestureDetector(
                      onTap: () => setState(() => _balanceVisible = !_balanceVisible),
                      child: Icon(
                        _balanceVisible ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                        color: Colors.white54,
                        size: 20,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                isLoading
                    ? const SizedBox(
                        height: 38,
                        child: Center(
                          child: LinearProgressIndicator(
                            backgroundColor: Colors.white24,
                            color: AhavaColors.gold500,
                          ),
                        ),
                      )
                    : Text(
                        _balanceVisible
                            ? _fmtZAR(availableCents)
                            : 'R •••••',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 34,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.5,
                        ),
                      ),
                if (pendingCents > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    '${_fmtZAR(pendingCents)} pending',
                    style: const TextStyle(color: Colors.white38, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    _WalletChip(icon: Icons.shield_outlined, label: 'Secured'),
                    const SizedBox(width: 8),
                    _WalletChip(icon: Icons.account_balance_outlined, label: 'ZAR'),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildQuickActions(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _QuickActionButton(
            icon: Icons.arrow_upward_rounded,
            label: 'Send',
            color: AhavaColors.navy700,
            onTap: () => context.go('/payment'),
          ),
          _QuickActionButton(
            icon: Icons.qr_code_rounded,
            label: 'My QR',
            color: const Color(0xFF0C447C),
            onTap: () => context.go('/qr'),
          ),
          _QuickActionButton(
            icon: Icons.qr_code_scanner,
            label: 'Scan QR',
            color: const Color(0xFF5B2D8E),
            onTap: () => context.go('/scan'),
          ),
          _QuickActionButton(
            icon: Icons.history,
            label: 'History',
            color: AhavaColors.success600,
            onTap: () => context.go('/history'),
          ),
        ],
      ),
    );
  }

  Widget _buildRecentTransactionsHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'Recent transactions',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          GestureDetector(
            onTap: () => context.go('/history'),
            child: const Text(
              'See all',
              style: TextStyle(fontSize: 13, color: AhavaColors.navy600, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  SliverList _buildRecentTransactions() {
    return SliverList(
      delegate: SliverChildListDelegate([
        BlocBuilder<WalletBloc, WalletState>(
          builder: (context, state) {
            if (state is TransactionHistoryLoaded) {
              if (state.transactions.isEmpty) return _emptyTransactions();
              return Column(
                children: state.transactions
                    .take(5)
                    .map((tx) => _TransactionRow(tx: tx))
                    .toList(),
              );
            }
            return _emptyTransactions();
          },
        ),
      ]),
    );
  }

  Widget _emptyTransactions() {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Center(
        child: Column(
          children: [
            Icon(Icons.receipt_long_outlined, size: 48, color: Colors.grey[300]),
            const SizedBox(height: 8),
            Text(
              'No transactions yet',
              style: TextStyle(color: Colors.grey[500]),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomNav() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 8, offset: const Offset(0, -1))],
      ),
      child: SafeArea(
        child: SizedBox(
          height: 60,
          child: Row(
            children: List.generate(_tabs.length, (i) {
              final tab = _tabs[i];
              final isActive = i == _selectedTab;
              return Expanded(
                child: InkWell(
                  onTap: () => _onTabTapped(i),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        isActive ? tab.activeIcon : tab.icon,
                        size: 22,
                        color: isActive ? AhavaColors.navy800 : Colors.grey[400],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        tab.label,
                        style: TextStyle(
                          fontSize: 10,
                          color: isActive ? AhavaColors.navy800 : Colors.grey[400],
                          fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }

  static String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  static String _fmtZAR(int cents) {
    return NumberFormat.currency(locale: 'en_ZA', symbol: 'R').format(cents / 100);
  }
}

class _TabItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  const _TabItem({required this.icon, required this.activeIcon, required this.label});
}

class _WalletChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _WalletChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Colors.white12,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: Colors.white60),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(color: Colors.white60, fontSize: 11)),
        ],
      ),
    );
  }
}

class _QuickActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _QuickActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(18),
              boxShadow: [BoxShadow(color: color.withOpacity(0.3), blurRadius: 8, offset: const Offset(0, 3))],
            ),
            child: Icon(icon, color: Colors.white, size: 24),
          ),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

class _TransactionRow extends StatelessWidget {
  final dynamic tx;
  const _TransactionRow({required this.tx});

  @override
  Widget build(BuildContext context) {
    final isCredit = tx.type == 'CREDIT';
    final fmt = NumberFormat.currency(locale: 'en_ZA', symbol: 'R');
    final amount = fmt.format(tx.amountCents / 100);

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 4)],
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: isCredit ? AhavaColors.success100 : AhavaColors.neutral100,
              shape: BoxShape.circle,
            ),
            child: Icon(
              isCredit ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
              color: isCredit ? AhavaColors.success600 : AhavaColors.neutral700,
              size: 18,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  tx.description ?? (isCredit ? 'Received' : 'Sent'),
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  DateFormat('d MMM, HH:mm').format(tx.createdAt as DateTime),
                  style: TextStyle(fontSize: 12, color: Colors.grey[400]),
                ),
              ],
            ),
          ),
          Text(
            '${isCredit ? '+' : '−'}$amount',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: isCredit ? AhavaColors.success600 : AhavaColors.neutral900,
            ),
          ),
        ],
      ),
    );
  }
}
