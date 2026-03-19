// apps/mobile/lib/core/security/lock_screen.dart
// Biometric + PIN lock screen used to secure the app when resumed.

import 'package:flutter/material.dart';
import 'package:local_auth/local_auth.dart';

typedef UnlockCallback = Future<bool> Function({String? pin});

class LockScreen extends StatefulWidget {
  final UnlockCallback onUnlock;

  const LockScreen({Key? key, required this.onUnlock}) : super(key: key);

  @override
  State<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends State<LockScreen> {
  final _pinController = TextEditingController();
  final _localAuth = LocalAuthentication();
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    _attemptBiometric();
  }

  @override
  void dispose() {
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _attemptBiometric() async {
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isAvailable = await _localAuth.isDeviceSupported();
      if (!canCheck || !isAvailable) return;

      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Unlock Ahava with biometrics',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );

      if (authenticated) {
        await _unlock();
      }
    } catch (_) {
      // ignore; fallback to PIN
    }
  }

  Future<void> _unlock({String? pin}) async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final success = await widget.onUnlock(pin: pin);

    if (!success) {
      setState(() {
        _error = 'Invalid PIN. Please try again.';
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor.withOpacity(0.95),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.lock, size: 56),
              const SizedBox(height: 16),
              Text(
                'Unlock Ahava',
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                'Use biometrics or enter your PIN to continue.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 24),
              TextField(
                controller: _pinController,
                obscureText: true,
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: '4-digit PIN',
                  errorText: _error,
                ),
                onSubmitted: (_) => _unlock(pin: _pinController.text),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: _loading ? null : () => _unlock(pin: _pinController.text),
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Unlock'),
              ),
              const SizedBox(height: 12),
              TextButton(
                onPressed: _attemptBiometric,
                child: const Text('Use biometric unlock'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
