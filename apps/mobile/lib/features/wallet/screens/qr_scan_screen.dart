// apps/mobile/lib/features/wallet/screens/qr_scan_screen.dart
// QR code scanner — reads Ahava wallet QR codes and pre-fills payment form.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../../core/theme/ahava_theme.dart';

class QrScanScreen extends StatefulWidget {
  const QrScanScreen({Key? key}) : super(key: key);

  @override
  State<QrScanScreen> createState() => _QrScanScreenState();
}

class _QrScanScreenState extends State<QrScanScreen> with WidgetsBindingObserver {
  final MobileScannerController _controller = MobileScannerController(
    detectionSpeed: DetectionSpeed.noDuplicates,
    returnImage: false,
  );

  bool _hasPermission = false;
  bool _scanned = false;
  bool _torchOn = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
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

    // Parse Ahava QR payload: ahava://pay?wallet=AHV-xxxx&amount=50.00
    final uri = Uri.tryParse(raw);
    if (uri != null && uri.scheme == 'ahava' && uri.host == 'pay') {
      final wallet = uri.queryParameters['wallet'];
      final amount = uri.queryParameters['amount'];
      if (wallet != null) {
        context.go('/payment', extra: {'wallet': wallet, 'amount': amount});
        return;
      }
    }

    // Unknown format — show dialog
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Unrecognised QR code'),
        content: Text('This QR code is not an Ahava payment code.\n\n$raw'),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.of(ctx).pop();
              setState(() => _scanned = false);
              _controller.start();
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
                const Icon(Icons.camera_alt_outlined, size: 64, color: Colors.grey),
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
          // Camera feed
          MobileScanner(
            controller: _controller,
            onDetect: _onDetect,
          ),

          // Viewfinder overlay
          CustomPaint(
            painter: _ViewfinderPainter(),
            child: const SizedBox.expand(),
          ),

          // Instructions
          Positioned(
            bottom: 60,
            left: 0,
            right: 0,
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  decoration: BoxDecoration(
                    color: Colors.black54,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Text(
                    'Point at an Ahava QR code to pay',
                    style: TextStyle(color: Colors.white, fontSize: 14),
                  ),
                ),
              ],
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
