"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import { motion } from "framer-motion";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Clear stale error state on mount (survives Fast Refresh otherwise)
  React.useEffect(() => {
    setError("");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleaned = phone.replace(/\s/g, "");
    if (!/^(\+27|0)[6-8]\d{8}$/.test(cleaned)) {
      setError("Enter a valid South African mobile number");
      return;
    }
    if (pin.length < 4) {
      setError("PIN must be at least 4 digits");
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.login(cleaned, pin);
      if (res.success && res.data) {
        if (res.data.userId) localStorage.setItem("userId", res.data.userId);
        localStorage.setItem("accessToken", res.data.accessToken);
        localStorage.setItem("refreshToken", res.data.refreshToken);
        if (res.data.walletId)
          localStorage.setItem("walletId", res.data.walletId);
        if (res.data.walletNumber)
          localStorage.setItem("walletNumber", res.data.walletNumber);
        if ((res.data as { user?: { kycTier?: string } }).user?.kycTier)
          localStorage.setItem(
            "kycTier",
            (res.data as { user?: { kycTier?: string } }).user!.kycTier!,
          );
        router.replace("/dashboard");
      } else {
        setError(res.error?.message || "Login failed");
      }
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { error?: { message?: string } } };
      };
      const status = axiosErr?.response?.status;
      const apiMsg = axiosErr?.response?.data?.error?.message;
      if (status === 429) {
        setError(
          apiMsg ||
            "Too many login attempts. Please wait 15 minutes and try again.",
        );
      } else if (status) {
        setError(apiMsg || `Login failed (${status})`);
      } else {
        console.error("Network Error Details:", err);
        setError("Unable to connect. Please check your network and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ahava-800 via-ahava-700 to-ahava-900 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-ahava-500/20 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-ahava-400/20 rounded-full blur-3xl"></div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm z-10"
      >
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-white rounded-2xl shadow-xl flex items-center justify-center mx-auto mb-6 transform rotate-3">
            <span className="text-3xl font-bold text-ahava-600 -rotate-3">
              A
            </span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Welcome back
          </h1>
          <p className="text-ahava-100 mt-2 font-medium opacity-90">
            Sign in to Ubuntu Wallet
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/95 backdrop-blur-xl rounded-[2.5rem] shadow-2xl p-8 border border-white/20">
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center gap-3"
            >
              <span className="text-red-500 text-lg">⚠</span>
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2 pl-1">
                Mobile number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="083 123 4567"
                className="input-field text-lg"
                autoComplete="tel"
                inputMode="tel"
                required
                suppressHydrationWarning
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2 pl-1">
                PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••••"
                className="input-field tracking-[0.5em] text-2xl text-center"
                autoComplete="current-password"
                inputMode="numeric"
                maxLength={6}
                required
                suppressHydrationWarning
              />
            </div>

            <button
              type="submit"
              className="btn-primary mt-6 text-lg h-14"
              disabled={loading}
            >
              {loading ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Signing in...</span>
                </div>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 font-medium mt-8">
            New to Ubuntu?{" "}
            <Link
              href="/auth/register"
              className="text-ahava-600 font-bold hover:text-ahava-700 transition-colors"
            >
              Create account
            </Link>
          </p>

          <div className="mt-8 flex items-center justify-center gap-2 text-gray-400 bg-gray-50 py-3 rounded-2xl border border-gray-100">
            <svg
              className="w-4 h-4 text-ahava-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-xs font-semibold text-gray-500">
              Secured by Bank-Grade Encryption
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
