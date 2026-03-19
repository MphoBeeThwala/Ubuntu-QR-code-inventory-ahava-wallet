// apps/mobile/lib/features/payments/screens/payment_screen.dart
// Basic payment screen placeholder.

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../bloc/payment_bloc.dart';

class PaymentScreen extends StatelessWidget {
  const PaymentScreen({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Send Payment')),
      body: BlocBuilder<PaymentBloc, PaymentState>(
        builder: (context, state) {
          if (state is PaymentProcessing) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is PaymentSuccess) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.check_circle, size: 64, color: Colors.green),
                  const SizedBox(height: 12),
                  const Text('Payment completed!'),
                  Text('Transaction: ${state.result.transactionId}'),
                ],
              ),
            );
          }
          if (state is PaymentFailure) {
            return Center(child: Text('Error: ${state.message}'));
          }
          return const Center(child: Text('Start a payment from the home screen.'));
        },
      ),
    );
  }
}
