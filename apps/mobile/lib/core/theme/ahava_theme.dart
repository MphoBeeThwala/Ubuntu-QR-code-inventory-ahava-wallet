// apps/mobile/lib/core/theme/ahava_theme.dart
// Ahava eWallet design system.
// Brand: deep navy trust + warm gold love. Clean, accessible, WCAG AA compliant.

import 'package:flutter/material.dart';

abstract final class AhavaColors {
  // ── Brand ───────────────────────────────────────────────────────
  static const navy900    = Color(0xFF0D1B2A);  // Primary brand — deepest navy
  static const navy800    = Color(0xFF1A2E44);  // Wallet card background
  static const navy700    = Color(0xFF1F3A55);  // Dark surface
  static const navy600    = Color(0xFF264B6E);  // Accent navy

  static const gold500    = Color(0xFFC9952A);  // Primary accent — Ahava gold
  static const gold400    = Color(0xFFDBA93A);  // Hover state
  static const gold100    = Color(0xFFFFF8E7);  // Light gold surface
  static const gold050    = Color(0xFFFFFCF2);  // Ultra light gold

  // ── Semantic ──────────────────────────────────────────────────
  static const success600 = Color(0xFF0D7A5F);  // Payment success green
  static const success100 = Color(0xFFE6F7F3);  // Success surface
  static const success050 = Color(0xFFF0FAF7);

  static const error600   = Color(0xFFA32D2D);  // Error / danger
  static const error100   = Color(0xFFFCEBEB);
  static const error050   = Color(0xFFFFF5F5);

  static const warning600 = Color(0xFF854F0B);  // Warning amber
  static const warning100 = Color(0xFFFAEEDA);

  static const info600    = Color(0xFF0C447C);  // Info blue
  static const info100    = Color(0xFFE6F1FB);

  // ── Neutral ──────────────────────────────────────────────────
  static const neutral900 = Color(0xFF0F0F0F);
  static const neutral700 = Color(0xFF3A3A3A);
  static const neutral500 = Color(0xFF6B6B6B);
  static const neutral300 = Color(0xFFB0B0B0);
  static const neutral200 = Color(0xFFD8D8D8);
  static const neutral100 = Color(0xFFF2F2F2);
  static const neutral050 = Color(0xFFF9F9F9);
  static const white      = Color(0xFFFFFFFF);
}

abstract final class AhavaTypography {
  static const fontFamily = 'AhavaSans';

  // Display — wallet balance, large amounts
  static const display = TextStyle(
    fontFamily: fontFamily,
    fontSize: 40,
    fontWeight: FontWeight.w500,
    letterSpacing: -1.5,
    height: 1.1,
  );

  static const heading1 = TextStyle(
    fontFamily: fontFamily,
    fontSize: 28,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.5,
    height: 1.2,
  );

  static const heading2 = TextStyle(
    fontFamily: fontFamily,
    fontSize: 22,
    fontWeight: FontWeight.w600,
    height: 1.3,
  );

  static const heading3 = TextStyle(
    fontFamily: fontFamily,
    fontSize: 18,
    fontWeight: FontWeight.w500,
    height: 1.4,
  );

  static const bodyLarge = TextStyle(
    fontFamily: fontFamily,
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.6,
  );

  static const body = TextStyle(
    fontFamily: fontFamily,
    fontSize: 14,
    fontWeight: FontWeight.w400,
    height: 1.5,
  );

  static const caption = TextStyle(
    fontFamily: fontFamily,
    fontSize: 12,
    fontWeight: FontWeight.w400,
    height: 1.4,
  );

  static const label = TextStyle(
    fontFamily: fontFamily,
    fontSize: 11,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.3,
    height: 1.3,
  );

  static const mono = TextStyle(
    fontFamily: 'Courier New',
    fontSize: 13,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.5,
  );
}

abstract final class AhavaTheme {
  static ThemeData get light => _buildTheme(Brightness.light);
  static ThemeData get dark => _buildTheme(Brightness.dark);

  static ThemeData _buildTheme(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final colorScheme = isDark
        ? ColorScheme.dark(
            primary: AhavaColors.gold500,
            onPrimary: AhavaColors.navy900,
            secondary: AhavaColors.navy600,
            onSecondary: AhavaColors.white,
            surface: AhavaColors.navy800,
            onSurface: AhavaColors.white,
            background: AhavaColors.navy900,
            onBackground: AhavaColors.white,
            error: AhavaColors.error600,
            onError: AhavaColors.white,
            outline: AhavaColors.navy600,
          )
        : ColorScheme.light(
            primary: AhavaColors.navy900,
            onPrimary: AhavaColors.white,
            secondary: AhavaColors.gold500,
            onSecondary: AhavaColors.navy900,
            surface: AhavaColors.white,
            onSurface: AhavaColors.neutral900,
            background: AhavaColors.neutral050,
            onBackground: AhavaColors.neutral900,
            error: AhavaColors.error600,
            onError: AhavaColors.white,
            outline: AhavaColors.neutral200,
          );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      brightness: brightness,
      fontFamily: AhavaTypography.fontFamily,

      // App bar — clean, flat, navy
      appBarTheme: AppBarTheme(
        backgroundColor: isDark ? AhavaColors.navy900 : AhavaColors.navy900,
        foregroundColor: AhavaColors.white,
        elevation: 0,
        scrolledUnderElevation: 0,
        titleTextStyle: AhavaTypography.heading3.copyWith(color: AhavaColors.white),
        iconTheme: const IconThemeData(color: AhavaColors.white, size: 22),
        centerTitle: false,
      ),

      // Scaffold
      scaffoldBackgroundColor: isDark ? AhavaColors.navy900 : AhavaColors.neutral050,

      // Cards
      cardTheme: CardTheme(
        color: isDark ? AhavaColors.navy800 : AhavaColors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: isDark ? AhavaColors.navy700 : AhavaColors.neutral200,
            width: 0.5,
          ),
        ),
        margin: EdgeInsets.zero,
      ),

      // Input fields
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AhavaColors.navy700 : AhavaColors.neutral100,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? AhavaColors.navy600 : AhavaColors.neutral200, width: 0.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? AhavaColors.navy600 : AhavaColors.neutral200, width: 0.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AhavaColors.gold500, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AhavaColors.error600, width: 1),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        labelStyle: AhavaTypography.body.copyWith(
          color: isDark ? AhavaColors.neutral300 : AhavaColors.neutral500,
        ),
        hintStyle: AhavaTypography.body.copyWith(
          color: isDark ? AhavaColors.neutral300 : AhavaColors.neutral300,
        ),
      ),

      // Primary button — navy with gold text
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AhavaColors.navy900,
          foregroundColor: AhavaColors.white,
          textStyle: AhavaTypography.body.copyWith(fontWeight: FontWeight.w500),
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          elevation: 0,
        ),
      ),

      // Secondary / outlined button
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: isDark ? AhavaColors.white : AhavaColors.navy900,
          textStyle: AhavaTypography.body.copyWith(fontWeight: FontWeight.w500),
          minimumSize: const Size(double.infinity, 52),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          side: BorderSide(
            color: isDark ? AhavaColors.navy600 : AhavaColors.neutral200,
            width: 0.5,
          ),
        ),
      ),

      // Bottom navigation bar
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: isDark ? AhavaColors.navy800 : AhavaColors.white,
        selectedItemColor: AhavaColors.gold500,
        unselectedItemColor: isDark ? AhavaColors.neutral300 : AhavaColors.neutral500,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        selectedLabelStyle: AhavaTypography.label,
        unselectedLabelStyle: AhavaTypography.label,
      ),

      // List tiles
      listTileTheme: ListTileThemeData(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
        iconColor: isDark ? AhavaColors.neutral300 : AhavaColors.neutral500,
        titleTextStyle: AhavaTypography.body.copyWith(
          fontWeight: FontWeight.w500,
          color: isDark ? AhavaColors.white : AhavaColors.neutral900,
        ),
        subtitleTextStyle: AhavaTypography.caption.copyWith(
          color: isDark ? AhavaColors.neutral300 : AhavaColors.neutral500,
        ),
      ),

      // Dividers
      dividerTheme: DividerThemeData(
        color: isDark ? AhavaColors.navy700 : AhavaColors.neutral200,
        thickness: 0.5,
        space: 0,
      ),

      // Bottom sheets
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: isDark ? AhavaColors.navy800 : AhavaColors.white,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        elevation: 0,
      ),

      // Chip (tier badges, category filters)
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AhavaColors.navy700 : AhavaColors.neutral100,
        selectedColor: AhavaColors.gold100,
        labelStyle: AhavaTypography.caption.copyWith(fontWeight: FontWeight.w500),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        side: BorderSide.none,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      ),

      // Progress indicators
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AhavaColors.gold500,
        linearTrackColor: AhavaColors.neutral200,
      ),

      // Snack bars
      snackBarTheme: SnackBarThemeData(
        backgroundColor: isDark ? AhavaColors.navy700 : AhavaColors.neutral900,
        contentTextStyle: AhavaTypography.body.copyWith(color: AhavaColors.white),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// DESIGN TOKENS — used in widget code for consistency
// ─────────────────────────────────────────────────────────────────

abstract final class AhavaSpacing {
  static const xs  = 4.0;
  static const sm  = 8.0;
  static const md  = 12.0;
  static const lg  = 16.0;
  static const xl  = 20.0;
  static const xxl = 24.0;
  static const xxxl = 32.0;
}

abstract final class AhavaRadius {
  static const sm  = Radius.circular(8);
  static const md  = Radius.circular(12);
  static const lg  = Radius.circular(16);
  static const xl  = Radius.circular(20);
  static const xxl = Radius.circular(24);
  static const pill = Radius.circular(100);
}
