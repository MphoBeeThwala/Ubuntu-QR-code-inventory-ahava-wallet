import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/theme/ahava_theme.dart';
import '../bloc/auth_bloc.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({Key? key}) : super(key: key);

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _phoneController = TextEditingController();
  final _pinController = TextEditingController();
  bool _showPin = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const SizedBox(height: 60),
              Text(
                'Ahava',
                style: theme.textTheme.headlineLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AhavaColors.gold500,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'South African digital wallet',
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 60),

              // Phone Input
              TextField(
                controller: _phoneController,
                decoration: InputDecoration(
                  hintText: 'Phone number (+27...)',
                  prefixIcon: const Icon(Icons.phone),
                ),
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: 16),

              // PIN Input
              TextField(
                controller: _pinController,
                obscureText: !_showPin,
                decoration: InputDecoration(
                  hintText: '4-digit PIN',
                  prefixIcon: const Icon(Icons.lock),
                  suffixIcon: IconButton(
                    icon: Icon(
                      _showPin ? Icons.visibility_off : Icons.visibility,
                    ),
                    onPressed: () => setState(() => _showPin = !_showPin),
                  ),
                ),
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 28),

              // Login Button
              BlocConsumer<AuthBloc, AuthState>(
                listener: (context, state) {
                  if (state is AuthError) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(state.message),
                        backgroundColor: AhavaColors.error600,
                      ),
                    );
                  }
                },
                builder: (context, state) {
                  return SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: state is AuthLoading
                          ? null
                          : () {
                              context.read<AuthBloc>().add(
                                    LoginRequested(
                                      phone: _phoneController.text,
                                      pin: _pinController.text,
                                    ),
                                  );
                            },
                      child: state is AuthLoading
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(Colors.white),
                              ),
                            )
                          : const Text('Login'),
                    ),
                  );
                },
              ),

              const SizedBox(height: 20),

              // Register Link
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Text("Don't have an account? "),
                  GestureDetector(
                    onTap: () {
                      // TODO: Navigate to registration screen
                    },
                    child: Text(
                      'Sign up',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: AhavaColors.gold500,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
