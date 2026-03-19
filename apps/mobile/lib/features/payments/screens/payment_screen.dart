// apps/mobile/lib/features/payments/screens/payment_screen.dart
// Payment UI flow: entry → confirmation → success/failure

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../bloc/payment_bloc.dart';

class PaymentScreen extends StatefulWidget {
  const PaymentScreen({Key? key}) : super(key: key);

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  @override
  void initState() {
    super.initState();
    // Always start from a clean payment state when entering the screen.
    context.read<PaymentBloc>().add(const PaymentReset());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Send Money')),
      body: BlocBuilder<PaymentBloc, PaymentState>(
        builder: (context, state) {
          if (state is PaymentProcessing) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is PaymentReady) {
            return PaymentConfirmationView(state: state);
          }

          if (state is PaymentSuccess) {
            return PaymentResultView(state: state);
          }

          if (state is PaymentFailure) {
            return PaymentFailureView(state: state);
          }

          return const PaymentEntryView();
        },
      ),
    );
  }
}

class PaymentEntryView extends StatefulWidget {
  const PaymentEntryView({Key? key}) : super(key: key);

  @override
  State<PaymentEntryView> createState() => _PaymentEntryViewState();
}

class _PaymentEntryViewState extends State<PaymentEntryView> {
  final _formKey = GlobalKey<FormState>();
  final _walletController = TextEditingController();
  final _amountController = TextEditingController();
  final _referenceController = TextEditingController();
  bool _isFamilyTransfer = false;

  @override
  void dispose() {
    _walletController.dispose();
    _amountController.dispose();
    _referenceController.dispose();
    super.dispose();
  }

  void _startPayment() {
    if (!_formKey.currentState!.validate()) return;

    final walletNumber = _walletController.text.trim();
    final amountText = _amountController.text.trim();
    final parsed = double.tryParse(amountText) ?? 0;
    final amountCents = (parsed * 100).round();

    context.read<PaymentBloc>().add(PaymentInitiated(
          recipientWalletNumber: walletNumber,
          amountCents: amountCents.toInt(),
          reference: _referenceController.text.trim(),
          isFamilyTransfer: _isFamilyTransfer,
        ));
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Send money', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 24),
            TextFormField(
              controller: _walletController,
              decoration: const InputDecoration(
                labelText: 'Recipient wallet number',
                hintText: 'AHV-1234-5678',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Recipient wallet number is required';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Amount (ZAR)',
                hintText: '100.00',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Amount is required';
                }
                final parsed = double.tryParse(value);
                if (parsed == null || parsed <= 0) {
                  return 'Enter a valid amount';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _referenceController,
              decoration: const InputDecoration(
                labelText: 'Reference (optional)',
                hintText: 'e.g. Rent payment',
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Checkbox(
                  value: _isFamilyTransfer,
                  onChanged: (value) {
                    setState(() {
                      _isFamilyTransfer = value ?? false;
                    });
                  },
                ),
                const Expanded(child: Text('Family transfer (fee waived under R200)')),
              ],
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _startPayment,
                child: const Text('Continue'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class PaymentConfirmationView extends StatelessWidget {
  final PaymentReady state;

  const PaymentConfirmationView({required this.state, super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Confirm payment', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 24),
          _buildDetailRow(context, 'Recipient', state.recipientName),
          _buildDetailRow(context, 'Wallet', state.recipientWalletNumber),
          _buildDetailRow(context, 'Amount', 'R ${(state.amountCents / 100).toStringAsFixed(2)}'),
          _buildDetailRow(context, 'Fee', state.formattedFee),
          _buildDetailRow(context, 'Total', state.formattedTotal),
          if (state.reference != null && state.reference!.isNotEmpty) ...[
            const SizedBox(height: 8),
            _buildDetailRow(context, 'Reference', state.reference!),
          ],
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    context.read<PaymentBloc>().add(const PaymentCancelled());
                  },
                  child: const Text('Edit details'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: () {
                    context.read<PaymentBloc>().add(const PaymentConfirmed());
                  },
                  child: const Text('Confirm & send'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 2,
            child: Text(label, style: Theme.of(context).textTheme.labelLarge),
          ),
          Expanded(
            flex: 3,
            child: Text(value, style: Theme.of(context).textTheme.bodyLarge),
          ),
        ],
      ),
    );
  }
}

class PaymentResultView extends StatelessWidget {
  final PaymentSuccess state;

  const PaymentResultView({required this.state, super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const Icon(Icons.check_circle, size: 72, color: Colors.green),
          const SizedBox(height: 16),
          Text('Payment sent!', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 16),
          Text('Transaction ID', style: Theme.of(context).textTheme.labelLarge),
          SelectableText(state.result.transactionId),
          const SizedBox(height: 12),
          Text('Amount', style: Theme.of(context).textTheme.labelLarge),
          Text('R ${(state.result.amountCents / 100).toStringAsFixed(2)}'),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () {
                context.read<PaymentBloc>().add(const PaymentReset());
                Navigator.of(context).pop();
              },
              child: const Text('Done'),
            ),
          ),
        ],
      ),
    );
  }
}

class PaymentFailureView extends StatelessWidget {
  final PaymentFailure state;

  const PaymentFailureView({required this.state, super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 72, color: Colors.red),
          const SizedBox(height: 16),
          Text('Payment failed', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 12),
          Text(state.message, textAlign: TextAlign.center),
          const SizedBox(height: 24),
          if (state.isRetryable) ...[
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  // Retry using the same payment intent if it exists.
                  if (state.previous != null) {
                    context.read<PaymentBloc>().add(PaymentInitiated(
                          recipientWalletNumber: state.previous!.recipientWalletNumber,
                          amountCents: state.previous!.amountCents,
                          reference: state.previous!.reference,
                          isFamilyTransfer: state.previous!.isFamilyTransfer,
                        ));
                    return;
                  }
                  context.read<PaymentBloc>().add(const PaymentReset());
                },
                child: const Text('Try again'),
              ),
            ),
            const SizedBox(height: 12),
          ],
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: () {
                context.read<PaymentBloc>().add(const PaymentReset());
              },
              child: const Text('Start new payment'),
            ),
          ),
        ],
      ),
    );
  }
}
