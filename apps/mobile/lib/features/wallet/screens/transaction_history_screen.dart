// apps/mobile/lib/features/wallet/screens/transaction_history_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';

import '../../../core/models/transaction.dart';
import '../bloc/wallet_bloc.dart';
import '../../../core/theme/ahava_theme.dart';

class TransactionHistoryScreen extends StatefulWidget {
  const TransactionHistoryScreen({super.key});

  @override
  State<TransactionHistoryScreen> createState() => _TransactionHistoryScreenState();
}

class _TransactionHistoryScreenState extends State<TransactionHistoryScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    context.read<WalletBloc>().add(TransactionHistoryRequested());
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(
        title: const Text('Transactions'),
        bottom: TabBar(
          controller: _tabController,
          indicatorColor: AhavaColors.success600,
          labelColor: AhavaColors.success600,
          unselectedLabelColor: Colors.grey[500],
          tabs: const [
            Tab(text: 'All'),
            Tab(text: 'Money In'),
            Tab(text: 'Money Out'),
          ],
        ),
      ),
      body: BlocBuilder<WalletBloc, WalletState>(
        builder: (context, state) {
          if (state is TransactionHistoryLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is TransactionHistoryLoaded) {
            return TabBarView(
              controller: _tabController,
              children: [
                _TransactionList(transactions: state.transactions),
                _TransactionList(
                  transactions: state.transactions.where((t) => t.isCredit).toList(),
                ),
                _TransactionList(
                  transactions: state.transactions.where((t) => t.isDebit).toList(),
                ),
              ],
            );
          }

          if (state is WalletLoadFailure) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, size: 48, color: Colors.red),
                  const SizedBox(height: 12),
                  Text(state.message, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () => context.read<WalletBloc>().add(TransactionHistoryRequested()),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }

          return const Center(child: CircularProgressIndicator());
        },
      ),
    );
  }
}

class _TransactionList extends StatelessWidget {
  final List<WalletTransaction> transactions;

  const _TransactionList({required this.transactions});

  @override
  Widget build(BuildContext context) {
    if (transactions.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.receipt_long_outlined, size: 56, color: Colors.grey[300]),
            const SizedBox(height: 12),
            Text(
              'No transactions yet',
              style: TextStyle(color: Colors.grey[500], fontSize: 16, fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 4),
            Text(
              'Your payment history will appear here',
              style: TextStyle(color: Colors.grey[400], fontSize: 13),
            ),
          ],
        ),
      );
    }

    // Group by date
    final groups = <String, List<WalletTransaction>>{};
    for (final tx in transactions) {
      final key = DateFormat('d MMMM yyyy').format(tx.createdAt);
      groups.putIfAbsent(key, () => []).add(tx);
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      itemCount: groups.length,
      itemBuilder: (context, index) {
        final date = groups.keys.elementAt(index);
        final txns = groups[date]!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Text(
                date,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Colors.grey[500],
                  letterSpacing: 0.5,
                ),
              ),
            ),
            Card(
              margin: EdgeInsets.zero,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              elevation: 0,
              color: Colors.white,
              child: Column(
                children: [
                  for (var i = 0; i < txns.length; i++) ...[
                    _TransactionTile(transaction: txns[i]),
                    if (i < txns.length - 1)
                      Divider(height: 1, indent: 60, color: Colors.grey[100]),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 8),
          ],
        );
      },
    );
  }
}

class _TransactionTile extends StatelessWidget {
  final WalletTransaction tx;

  const _TransactionTile({required this.transaction}) : tx = transaction;

  final WalletTransaction transaction;

  String _fmtAmount() {
    final rands = tx.amountCents / 100;
    final fmt = NumberFormat.currency(locale: 'en_ZA', symbol: 'R');
    return fmt.format(rands);
  }

  @override
  Widget build(BuildContext context) {
    final isCredit = tx.isCredit;
    final statusColor = switch (tx.status) {
      'COMPLETED' => Colors.green[700]!,
      'PENDING'   => Colors.amber[700]!,
      'FAILED'    => Colors.red[600]!,
      'REVERSED'  => Colors.grey[400]!,
      _           => Colors.grey[500]!,
    };

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: isCredit ? Colors.green[50] : Colors.grey[100],
          shape: BoxShape.circle,
        ),
        child: Icon(
          isCredit ? Icons.arrow_downward_rounded : Icons.arrow_upward_rounded,
          color: isCredit ? Colors.green[700] : Colors.grey[600],
          size: 20,
        ),
      ),
      title: Text(
        tx.description ?? (isCredit ? 'Received' : 'Sent'),
        style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Row(
        children: [
          Text(
            DateFormat('HH:mm').format(tx.createdAt),
            style: TextStyle(fontSize: 12, color: Colors.grey[400]),
          ),
          const SizedBox(width: 6),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            decoration: BoxDecoration(
              color: Colors.grey[100],
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              tx.channel,
              style: TextStyle(fontSize: 10, color: Colors.grey[500]),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            tx.status.toLowerCase(),
            style: TextStyle(fontSize: 11, color: statusColor, fontWeight: FontWeight.w500),
          ),
        ],
      ),
      trailing: Text(
        '${isCredit ? '+' : '−'}${_fmtAmount()}',
        style: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.bold,
          color: isCredit ? Colors.green[700] : Colors.grey[900],
        ),
      ),
    );
  }
}
