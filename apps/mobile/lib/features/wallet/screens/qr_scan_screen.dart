// apps/mobile/lib/features/wallet/screens/qr_scan_screen.dart
// QR code scanner — reads Ahava wallet QR codes, looks up details, and pays.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:uuid/uuid.dart';

import '../../../core/di/service_locator.dart';
import '../../../core/errors/ahava_error.dart';
import '../../../core/repositories/qr_repository.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/theme/ahava_theme.dart';

class QrScanScreen extends StatefulWidget {
  const QrScanScreen({Key? key}) : super(key: key);

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen>
    with WidgetsBindingObserver {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    returnImage: false,
  );

  late final QrRepository _qrRepository;

  bool _hasPermission = false;
  bool _scanned = false;
  bool _torchOn = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _qrRepository = sl<QrRepository>();
    _requestPermission();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!_controller.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      _controller.stop();
    } else if (state == AppLifecycleState.resumed) {
      _controller.start();
    }
  }

  Future<void> _requestPermission() async {
    final status = await Permission.camera.request();
    setState(() => _hasPermission = status.isGranted);
  }

  void _onDetect(BarcodeCapture capture) {
    if (_scanned) return;
    final barcode = capture.barcodes.firstOrNull;
    if (barcode == null || barcode.rawValue == null) return;

    final raw = barcode.rawValue!;
    setState(() => _scanned = true);
    HapticFeedback.mediumImpact();
    _controller.stop();

    // Parse ahava://pay?qr=<hash>
    final uri = Uri.tryParse(raw);
    String? qrHash;
    if (uri != null && uri.scheme == 'ahava' && uri.host == 'pay') {
      qrHash = uri.queryParameters['qr'];
    }

    if (qrHash == null || qrHash.isEmpty) {
      _showUnrecognisedDialog(raw);
      return;
    }

    _lookupAndConfirm(qrHash);
  }

  Future<void> _lookupAndConfirm(String qrHash) async {
    // Show a loading sheet while looking up
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => const _LoadingSheet(),
    );

    try {
      final qrInfo = await _qrRepository.lookupQr(qrHash);
      if (!mounted) return;
      Navigator.of(context).pop(); // close loading sheet

      if (qrInfo.isExpired) {
        _showErrorSnack('This QR code has expired.');
        _resetScanner();
        return;
      }

      // Show confirm bottom sheet
      final confirmedCents = await showModalBottomSheet<int>(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        builder: (ctx) => _ConfirmPaymentSheet(qrInfo: qrInfo),
      );

      if (confirmedCents == null || confirmedCents <= 0) {
        _resetScanner();
        return;
      }

      await _pay(qrHash, qrInfo, confirmedCents);
    } on AhavaError catch (e) {
      if (!mounted) return;
      Navigator.of(context).pop(); // close loading sheet
      _showErrorSnack(e.userMessage);
      _resetScanner();
    } catch (_) {
      if (!mounted) return;
      Navigator.of(context).pop();
      _showErrorSnack('Failed to look up QR code. Try again.');
      _resetScanner();
    }
  }

  Future<void> _pay(String qrHash, QrInfo qrInfo, int amountCents) async {
    final tokenStorage = sl<TokenStorage>();
    final walletId = await tokenStorage.walletId;
    if (walletId == null || !mounted) {
      _showErrorSnack('Wallet not found. Please sign in again.');
      return;
    }

    // Show processing sheet
    showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => const _ProcessingSheet(),
    );

    try {
      final result = await _qrRepository.payViaQr(
        qrHash: qrHash,
        senderWalletId: walletId,
        amountCents: amountCents,
        idempotencyKey: const Uuid().v4(),
      );

      if (!mounted) return;
      Navigator.of(context).pop(); // close processing sheet

      await showModalBottomSheet<void>(
        context: context,
        isDismissible: false,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        builder: (ctx) => _SuccessSheet(
          qrInfo: qrInfo,
          result: result,
          onDone: () {
            Navigator.of(ctx).pop();
            context.go('/home');
          },
          onScanAnother: () {
            Navigator.of(ctx).pop();
            _resetScanner();
          },
        ),
      );
    } on AhavaError catch (e) {
      if (!mounted) return;
      Navigator.of(context).pop();
      _showErrorSnack(e.userMessage);
      _resetScanner();
    } catch (_) {
      if (!mounted) return;
      Navigator.of(context).pop();
      _showErrorSnack('Payment failed. Please try again.');
      _resetScanner();
    }
  }

  void _resetScanner() {
    setState(() => _scanned = false);
    _controller.start();
  }

  void _showErrorSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: Colors.red.shade700,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _showUnrecognisedDialog(String raw) {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Unrecognised QR code'),
        content: Text(
          'This QR code is not an Ahava payment code.\n\n$raw',
          maxLines: 4,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              _resetScanner();
            },
            child: const Text('Try again'),
          ),
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              context.go('/home');
            },
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!_hasPermission) {
      return Scaffold(
        appBar: AppBar(title: const Text('Scan QR')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.camera_alt_outlined,
                    size: 64, color: Colors.grey),
                const SizedBox(height: 16),
                const Text(
                  'Camera permission required',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                const Text(
                  'Ahava needs camera access to scan QR codes.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.grey),
                ),
                const SizedBox(height: 24),
                ElevatedButton(
                  onPressed: _requestPermission,
                  child: const Text('Grant permission'),
                ),
                TextButton(
                  onPressed: openAppSettings,
                  child: const Text('Open settings'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Scan QR Code'),
        actions: [
          IconButton(
            icon: Icon(_torchOn ? Icons.flash_on : Icons.flash_off),
            onPressed: () {
              _controller.toggleTorch();
              setState(() => _torchOn = !_torchOn);
            },
          ),
          IconButton(
            icon: const Icon(Icons.flip_camera_ios_outlined),
            onPressed: _controller.switchCamera,
          ),
        ],
      ),
      body: Stack(
        children: [
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),
          CustomPaint(
            painter: _ViewfinderPainter(),
            child: const SizedBox.expand(),
          ),
          Positioned(
            bottom: 60,
            left: 0,
            right: 0,
            child: Center(
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Text(
                  'Point at an Ahava QR code to pay',
                  style: TextStyle(color: Colors.white, fontSize: 14),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ViewfinderPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final overlayPaint = Paint()..color = Colors.black54;
    final cutoutSize = size.width * 0.72;
    final left = (size.width - cutoutSize) / 2;
    final top = (size.height - cutoutSize) / 2;
    final cutout = Rect.fromLTWH(left, top, cutoutSize, cutoutSize);

    final overlay = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
      ..addRRect(RRect.fromRectAndRadius(cutout, const Radius.circular(16)))
      ..fillType = PathFillType.evenOdd;

    canvas.drawPath(overlay, overlayPaint);

    // Corner brackets
    const bracketLen = 28.0;
    const bracketWidth = 4.0;
    final cornerPaint = Paint()
      ..color = AhavaColors.success600
      ..strokeWidth = bracketWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final corners = [
      [Offset(left, top + bracketLen), Offset(left, top), Offset(left + bracketLen, top)],
      [
        Offset(left + cutoutSize - bracketLen, top),
        Offset(left + cutoutSize, top),
        Offset(left + cutoutSize, top + bracketLen),
      ],
      [
        Offset(left + cutoutSize, top + cutoutSize - bracketLen),
        Offset(left + cutoutSize, top + cutoutSize),
        Offset(left + cutoutSize - bracketLen, top + cutoutSize),
      ],
      [
        Offset(left + bracketLen, top + cutoutSize),
        Offset(left, top + cutoutSize),
        Offset(left, top + cutoutSize - bracketLen),
      ],
    ];

    for (final pts in corners) {
      final path = Path()
        ..moveTo(pts[0].dx, pts[0].dy)
        ..lineTo(pts[1].dx, pts[1].dy)
        ..lineTo(pts[2].dx, pts[2].dy);
      canvas.drawPath(path, cornerPaint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ── Helper: format ZAR cents ──────────────────────────────────────────────────
String _fmtZar(int cents) {
  final rands = cents / 100;
  return 'R ${rands.toStringAsFixed(2)}';
}

// ── Loading sheet ─────────────────────────────────────────────────────────────
class _LoadingSheet extends StatelessWidget {
  const _LoadingSheet();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 160,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Looking up QR code…', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}

// ── Processing sheet ──────────────────────────────────────────────────────────
class _ProcessingSheet extends StatelessWidget {
  const _ProcessingSheet();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 160,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Processing payment…', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}

// ── Confirm payment sheet ─────────────────────────────────────────────────────
class _ConfirmPaymentSheet extends StatefulWidget {
  final QrInfo qrInfo;
  const _ConfirmPaymentSheet({required this.qrInfo});

  @override
  State<_ConfirmPaymentSheet> createState() => _ConfirmPaymentSheetState();
}

class _ConfirmPaymentSheetState extends State<_ConfirmPaymentSheet> {
  final _amountController = TextEditingController();

  @override
  void initState() {
    super.initState();
    if (widget.qrInfo.amountCents != null) {
      _amountController.text =
          (widget.qrInfo.amountCents! / 100).toStringAsFixed(2);
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isLocked = widget.qrInfo.hasLockedAmount;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.fromLTRB(24, 24, 24, 24 + bottomInset),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle bar
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),

          const Text(
            'Confirm Payment',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),

          // Recipient info
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.grey.shade200),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AhavaColors.gold100,
                    shape: BoxShape.circle,
                  ),
                  child: Center(
                    child: Text(
                      widget.qrInfo.walletNumber.isNotEmpty
                          ? widget.qrInfo.walletNumber[0]
                          : 'W',
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        color: AhavaColors.navy900,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        widget.qrInfo.walletNumber,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontFamily: 'monospace',
                        ),
                      ),
                      if (widget.qrInfo.description != null)
                        Text(
                          widget.qrInfo.description!,
                          style: TextStyle(
                              fontSize: 12, color: Colors.grey.shade600),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Amount field
          TextField(
            controller: _amountController,
            enabled: !isLocked,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
            decoration: InputDecoration(
              prefixText: 'R ',
              prefixStyle:
                  const TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
              hintText: '0.00',
              filled: true,
              fillColor: Colors.grey.shade50,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: Colors.grey.shade200),
              ),
              helperText: isLocked ? 'Amount fixed by QR code' : null,
            ),
          ),
          const SizedBox(height: 20),

          // Buttons
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Cancel'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                flex: 2,
                child: ElevatedButton(
                  onPressed: () {
                    final cents = (double.tryParse(_amountController.text) ??
                            0) *
                        100;
                    if (cents <= 0) return;
                    Navigator.of(context).pop(cents.round());
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AhavaColors.navy900,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: Text(
                    'Pay ${_amountController.text.isNotEmpty ? "R ${_amountController.text}" : ""}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ── Success sheet ─────────────────────────────────────────────────────────────
class _SuccessSheet extends StatelessWidget {
  final QrInfo qrInfo;
  final QrPayResult result;
  final VoidCallback onDone;
  final VoidCallback onScanAnother;

  const _SuccessSheet({
    required this.qrInfo,
    required this.result,
    required this.onDone,
    required this.onScanAnother,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 24, 24, 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: Colors.green.shade50,
              shape: BoxShape.circle,
            ),
            child: Icon(Icons.check_circle_outline_rounded,
                size: 44, color: Colors.green.shade600),
          ),
          const SizedBox(height: 16),
          const Text(
            'Payment Sent!',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Text(
            '${_fmtZar(result.amountCents)} sent to ${qrInfo.walletNumber}',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.grey.shade600),
          ),
          const SizedBox(height: 8),
          Text(
            result.transactionId,
            style: TextStyle(
              fontSize: 11,
              color: Colors.grey.shade400,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: 28),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onScanAnother,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Scan Another'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: onDone,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AhavaColors.navy900,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Done',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
