import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/theme/ahava_theme.dart';
import '../bloc/auth_bloc.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> with SingleTickerProviderStateMixin {
  final _phoneController = TextEditingController();
  final _pinController = TextEditingController();
  bool _showPin = false;

  late AnimationController _animController;
  late Animation<double> _fadeAnim;
  late Animation<Offset> _slideAnim;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _fadeAnim = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOut),
    );
    _slideAnim = Tween<Offset>(begin: const Offset(0, 0.1), end: Offset.zero).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeOutCubic),
    );
    _animController.forward();
  }

  @override
  void dispose() {
    _animController.dispose();
    _phoneController.dispose();
    _pinController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: isDark 
                ? [AhavaColors.navy900, AhavaColors.navy800]
                : [AhavaColors.navy900, AhavaColors.navy700],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(horizontal: AhavaSpacing.xxl),
              child: FadeTransition(
                opacity: _fadeAnim,
                child: SlideTransition(
                  position: _slideAnim,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Logo Box (Matches PWA style)
                      Transform.rotate(
                        angle: -0.05,
                        child: Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: AhavaColors.white,
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 51),
                                blurRadius: 20,
                                offset: const Offset(0, 10),
                              )
                            ],
                          ),
                          child: Center(
                            child: Text(
                              'A',
                              style: AhavaTypography.heading1.copyWith(
                                color: AhavaColors.navy900,
                                fontSize: 36,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: AhavaSpacing.xxl),
                      
                      Text(
                        'Welcome back',
                        style: AhavaTypography.heading1.copyWith(color: AhavaColors.white),
                      ),
                      const SizedBox(height: AhavaSpacing.sm),
                      Text(
                        'Sign in to Ahava Wallet',
                        style: AhavaTypography.body.copyWith(
                          color: AhavaColors.white.withValues(alpha: 204),
                        ),
                      ),
                      const SizedBox(height: 40),

                      // Glassmorphic Card
                      Container(
                        padding: const EdgeInsets.all(AhavaSpacing.xxl),
                        decoration: BoxDecoration(
                          color: AhavaColors.white.withValues(alpha: 242),
                          borderRadius: BorderRadius.circular(32),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 26),
                              blurRadius: 30,
                              offset: const Offset(0, 10),
                            )
                          ],
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Mobile number',
                              style: AhavaTypography.label.copyWith(
                                color: AhavaColors.neutral700,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: AhavaSpacing.sm),
                            TextField(
                              controller: _phoneController,
                              style: AhavaTypography.bodyLarge,
                              decoration: const InputDecoration(
                                hintText: '083 123 4567',
                                fillColor: AhavaColors.neutral050,
                                prefixIcon: Icon(Icons.phone_outlined, color: AhavaColors.neutral500),
                              ),
                              keyboardType: TextInputType.phone,
                            ),
                            const SizedBox(height: AhavaSpacing.xl),

                            Text(
                              'PIN',
                              style: AhavaTypography.label.copyWith(
                                color: AhavaColors.neutral700,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: AhavaSpacing.sm),
                            TextField(
                              controller: _pinController,
                              obscureText: !_showPin,
                              style: AhavaTypography.mono.copyWith(
                                fontSize: 24,
                                letterSpacing: 8,
                                fontWeight: FontWeight.bold,
                              ),
                              textAlign: TextAlign.center,
                              decoration: InputDecoration(
                                hintText: '••••••',
                                fillColor: AhavaColors.neutral050,
                                suffixIcon: IconButton(
                                  icon: Icon(
                                    _showPin ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                                    color: AhavaColors.neutral500,
                                  ),
                                  onPressed: () => setState(() => _showPin = !_showPin),
                                ),
                              ),
                              keyboardType: TextInputType.number,
                              maxLength: 6,
                            ),
                            const SizedBox(height: AhavaSpacing.xxl),

                            BlocConsumer<AuthBloc, AuthState>(
                              listener: (context, state) {
                                if (state is AuthError) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text(state.message)),
                                  );
                                }
                              },
                              builder: (context, state) {
                                return SizedBox(
                                  width: double.infinity,
                                  height: 56,
                                  child: FilledButton(
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
                                            height: 24,
                                            width: 24,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              valueColor: AlwaysStoppedAnimation(Colors.white),
                                            ),
                                          )
                                        : Text(
                                            'Sign in',
                                            style: AhavaTypography.bodyLarge.copyWith(
                                              color: AhavaColors.white,
                                              fontWeight: FontWeight.bold,
                                            ),
                                          ),
                                  ),
                                );
                              },
                            ),

                            const SizedBox(height: AhavaSpacing.xxl),
                            
                            // Trust Signal
                            Container(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              decoration: BoxDecoration(
                                color: AhavaColors.neutral050,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(color: AhavaColors.neutral200),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.lock_outline, size: 16, color: AhavaColors.navy600),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Secured by Bank-Grade Encryption',
                                    style: AhavaTypography.caption.copyWith(
                                      color: AhavaColors.neutral700,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      
                      const SizedBox(height: AhavaSpacing.xxl),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            "New to Ahava? ",
                            style: AhavaTypography.body.copyWith(color: AhavaColors.white.withValues(alpha: 204)),
                          ),
                          GestureDetector(
                            onTap: () {
                            },
                            child: Text(
                              'Create account',
                              style: AhavaTypography.body.copyWith(
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
            ),
          ),
        ),
      ),
    );
  }
}
