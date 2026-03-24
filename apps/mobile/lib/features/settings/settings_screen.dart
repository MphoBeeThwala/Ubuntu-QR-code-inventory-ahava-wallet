// apps/mobile/lib/features/settings/settings_screen.dart

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/theme/ahava_theme.dart';
import '../auth/bloc/auth_bloc.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _localAuth = LocalAuthentication();
  final _secureStorage = const FlutterSecureStorage();

  bool _biometricEnabled = false;
  bool _biometricAvailable = false;
  String _appVersion = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final [canCheck, storedBio, packageInfo] = await Future.wait([
      _localAuth.canCheckBiometrics,
      _secureStorage.read(key: 'biometric_enabled'),
      PackageInfo.fromPlatform(),
    ]);

    setState(() {
      _biometricAvailable = canCheck as bool;
      _biometricEnabled = (storedBio as String?) == 'true';
      _appVersion = '${(packageInfo as PackageInfo).version}+${packageInfo.buildNumber}';
      _loading = false;
    });
  }

  Future<void> _toggleBiometric(bool value) async {
    if (value) {
      // Verify biometric before enabling
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Confirm your identity to enable biometric login',
        options: const AuthenticationOptions(biometricOnly: true, stickyAuth: true),
      );
      if (!authenticated) return;
    }
    await _secureStorage.write(key: 'biometric_enabled', value: value.toString());
    setState(() => _biometricEnabled = value);
  }

  Future<void> _changePin() async {
    context.go('/change-pin');
  }

  @override
  Widget build(BuildContext context) {
    final authState = context.read<AuthBloc>().state;
    final maskedPhone = authState is AuthAuthenticated
        ? '${authState.session.userId.substring(0, 4)}****'
        : '—';

    return Scaffold(
      backgroundColor: Colors.grey[50],
      appBar: AppBar(title: const Text('Settings')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                // Account section
                const _SectionHeader('Account'),
                _SettingsTile(
                  icon: Icons.person_outline,
                  title: 'Profile',
                  subtitle: maskedPhone,
                  onTap: () {},
                ),
                _SettingsTile(
                  icon: Icons.verified_user_outlined,
                  title: 'Identity verification',
                  subtitle: 'Upgrade your KYC tier for higher limits',
                  onTap: () => context.go('/kyc-upgrade'),
                ),
                _SettingsTile(
                  icon: Icons.lock_outline,
                  title: 'Change PIN',
                  onTap: _changePin,
                ),

                // Security section
                const _SectionHeader('Security'),
                if (_biometricAvailable)
                  SwitchListTile(
                    secondary: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: AhavaColors.success600.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.fingerprint, color: AhavaColors.success600),
                    ),
                    title: const Text(
                      'Biometric login',
                      style: TextStyle(fontWeight: FontWeight.w500),
                    ),
                    subtitle: const Text('Use Face ID or fingerprint to sign in'),
                    value: _biometricEnabled,
                    onChanged: _toggleBiometric,
                    activeThumbColor: AhavaColors.success600,
                  ),
                _SettingsTile(
                  icon: Icons.devices_outlined,
                  title: 'Trusted devices',
                  subtitle: 'Manage devices that can log in',
                  onTap: () {},
                ),

                // Notifications section
                const _SectionHeader('Notifications'),
                _SettingsTile(
                  icon: Icons.notifications_outlined,
                  title: 'Push notifications',
                  subtitle: 'Payments, balance updates, security alerts',
                  onTap: () {},
                ),

                // Support section
                const _SectionHeader('Support'),
                _SettingsTile(
                  icon: Icons.help_outline,
                  title: 'Help centre',
                  onTap: () {},
                ),
                _SettingsTile(
                  icon: Icons.privacy_tip_outlined,
                  title: 'Privacy policy',
                  subtitle: 'POPIA compliance information',
                  onTap: () {},
                ),
                _SettingsTile(
                  icon: Icons.description_outlined,
                  title: 'Terms of service',
                  onTap: () {},
                ),

                // App info
                const _SectionHeader('App'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: Colors.grey[100],
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(Icons.info_outline, color: Colors.grey[500]),
                      ),
                      const SizedBox(width: 16),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Version', style: TextStyle(fontWeight: FontWeight.w500)),
                          Text(
                            _appVersion,
                            style: TextStyle(fontSize: 12, color: Colors.grey[500]),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                // Sign out
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: OutlinedButton.icon(
                    icon: const Icon(Icons.logout, color: Colors.red),
                    label: const Text('Sign out', style: TextStyle(color: Colors.red)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Colors.red),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    onPressed: () {
                      context.read<AuthBloc>().add(LogoutRequested());
                    },
                  ),
                ),
                const SizedBox(height: 32),
              ],
            ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: Colors.grey[500],
          letterSpacing: 1.0,
        ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback? onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AhavaColors.success600.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, color: AhavaColors.success600, size: 20),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w500)),
      subtitle: subtitle != null
          ? Text(subtitle!, style: TextStyle(fontSize: 12, color: Colors.grey[500]))
          : null,
      trailing: Icon(Icons.chevron_right, color: Colors.grey[400]),
      onTap: onTap,
    );
  }
}
