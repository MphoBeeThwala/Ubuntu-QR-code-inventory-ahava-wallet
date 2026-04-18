// apps/mobile/lib/features/home/home_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/theme/ahava_theme.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/wallet/bloc/wallet_bloc.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

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
      backgroundColor: AhavaColors.navy900,
      foregroundColor: Colors.white,
      automaticallyImplyLeading: false,
      flexibleSpace: FlexibleSpaceBar(
        background: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AhavaColors.navy900, AhavaColors.navy800],
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
              Container(
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 26),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: IconButton(
                  icon: const Icon(Icons.notifications_outlined, color: Colors.white),
                  onPressed: () {},
                ),
              ),
            ],
          ),
        ),
        title: const Text('Ahava', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
        titlePadding: const EdgeInsets.only(left: 20, bottom: 16),
        collapseMode: CollapseMode.parallax,
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
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [AhavaColors.navy800, AhavaColors.navy600],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(32),
              boxShadow: [
                BoxShadow(
                  color: AhavaColors.navy900.withValues(alpha: 38),
                  blurRadius: 20,
                  offset: const Offset(0, 10),
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
                      style: TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.w500),
                    ),
                    GestureDetector(
                      onTap: () => setState(() => _balanceVisible = !_balanceVisible),
                      child: Icon(
                        _balanceVisible ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                        color: Colors.white70,
                        size: 22,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                isLoading
                    ? const SizedBox(
                        height: 48,
                        child: Center(
                          child: CircularProgressIndicator(
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
                          fontSize: 40,
                          fontWeight: FontWeight.bold,
                          letterSpacing: -1,
                        ),
                      ),
                if (pendingCents > 0) ...[
                  const SizedBox(height: 4),
                  Text(
                    '${_fmtZAR(pendingCents)} pending',
                    style: const TextStyle(color: Colors.white54, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 24),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () => context.go('/wallet/add'),
                        icon: const Icon(Icons.add, size: 18),
                        label: const Text('Top Up'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white.withValues(alpha: 51),
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () => context.go('/history'),
                        icon: const Icon(Icons.history, size: 18),
                        label: const Text('Details'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.white.withValues(alpha: 26),
                          foregroundColor: Colors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
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
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 8, offset: Offset(0, -1))],
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
              boxShadow: [BoxShadow(color: color.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 3))],
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
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 4)],
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
