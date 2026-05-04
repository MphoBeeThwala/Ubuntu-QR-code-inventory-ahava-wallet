// apps/mobile/lib/features/wallet/screens/my_qr_screen.dart
// Displays the user's static QR code for receiving payments.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../../../core/di/service_locator.dart';
import '../../../core/repositories/qr_repository.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/theme/ahava_theme.dart';

class MyQrScreen extends StatefulWidget {
  const MyQrScreen({super.key});

  @override
  State<MyQrScreen> createState() => _MyQrScreenState();
}

class _MyQrScreenState extends State<MyQrScreen> {
  String? _deepLink;
  String? _walletNumber;
  String? _errorMsg;
  bool _loading = true;
  bool _copied = false;

  @override
  void initState() {
    super.initState();
    _loadQr();
  }

  Future<void> _loadQr() async {
    setState(() {
      _loading = true;
      _errorMsg = null;
    });

    try {
      final tokenStorage = sl<TokenStorage>();
      final walletId = await tokenStorage.walletId;

      if (walletId == null) {
        setState(() {
          _errorMsg = 'Wallet not found. Please sign in again.';
          _loading = false;
        });
        return;
      }

      final qrRepo = sl<QrRepository>();

      // Generate (or retrieve existing) static QR
      final generated = await qrRepo.generateQr(walletId);

      // Look up the QR to get the wallet number for display
      final info = await qrRepo.lookupQr(generated.qrHash);

      setState(() {
        _deepLink = generated.deepLink;
        _walletNumber = info.walletNumber;
        _loading = false;
      });
    } catch (_) {
      setState(() {
        _errorMsg = 'Failed to load QR code. Please try again.';
        _loading = false;
      });
    }
  }

  Future<void> _copyLink() async {
    if (_deepLink == null) return;
    await Clipboard.setData(ClipboardData(text: _deepLink!));
    setState(() => _copied = true);
    await Future.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _copied = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AhavaColors.navy900,
      appBar: AppBar(
        title: const Text('My QR Code'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: SafeArea(
        child: _loading
            ? const Center(
                child: CircularProgressIndicator(color: AhavaColors.gold500))
            : _errorMsg != null
                ? _buildError()
                : _buildQrContent(),
      ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline_rounded,
                size: 56, color: AhavaColors.gold500),
            const SizedBox(height: 16),
            Text(
              _errorMsg!,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: _loadQr,
              style: ElevatedButton.styleFrom(
                backgroundColor: AhavaColors.gold500,
                foregroundColor: AhavaColors.navy900,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQrContent() {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      child: Column(
        children: [
          Text(
            'Others scan this to pay you',
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.6),
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 28),

          // QR Card
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.4),
                  blurRadius: 30,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              children: [
                QrImageView(
                  data: _deepLink!,
                  version: QrVersions.auto,
                  size: 240,
                  backgroundColor: Colors.white,
                  eyeStyle: const QrEyeStyle(
                    eyeShape: QrEyeShape.square,
                    color: AhavaColors.navy900,
                  ),
                  dataModuleStyle: const QrDataModuleStyle(
                    dataModuleShape: QrDataModuleShape.square,
                    color: AhavaColors.navy900,
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: AhavaColors.gold500,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Text(
                      'Ubuntu Wallet',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AhavaColors.navy900,
                      ),
                    ),
                  ],
                ),
                if (_walletNumber != null) ...[
                  const SizedBox(height: 6),
                  Text(
                    _walletNumber!,
                    style: TextStyle(
                      fontSize: 12,
                      color: AhavaColors.navy900.withValues(alpha: 0.45),
                      fontFamily: 'monospace',
                      letterSpacing: 1,
                    ),
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: 32),

          Text(
            'Share your QR code with anyone to receive instant payments',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.45),
              fontSize: 13,
            ),
          ),

          const SizedBox(height: 28),

          // Copy link button
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _copyLink,
              icon: Icon(_copied
                  ? Icons.check_rounded
                  : Icons.copy_rounded),
              label: Text(_copied ? 'Copied!' : 'Copy Payment Link'),
              style: ElevatedButton.styleFrom(
                backgroundColor:
                    _copied ? AhavaColors.success600 : AhavaColors.gold500,
                foregroundColor: _copied ? Colors.white : AhavaColors.navy900,
                padding: const EdgeInsets.symmetric(vertical: 16),
                textStyle: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.bold),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),

          const SizedBox(height: 12),

          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => context.go('/scan'),
              icon: const Icon(Icons.qr_code_scanner_rounded),
              label: const Text('Scan to Pay'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Colors.white,
                side: BorderSide(color: Colors.white.withValues(alpha: 0.2)),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
