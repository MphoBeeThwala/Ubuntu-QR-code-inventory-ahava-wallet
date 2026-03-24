"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    } catch {
      setError("Unable to connect. Please check your network and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-ahava-700 to-ahava-900 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white">Ahava</h1>
          <p className="text-ahava-200 mt-1 text-sm">
            South African Digital Wallet
          </p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Sign in</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0831234567"
                className="input-field"
                autoComplete="tel"
                inputMode="tel"
                required
                suppressHydrationWarning
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••••"
                className="input-field tracking-widest"
                autoComplete="current-password"
                inputMode="numeric"
                maxLength={6}
                required
                suppressHydrationWarning
              />
            </div>

            <button
              type="submit"
              className="btn-primary mt-2"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            No account?{" "}
            <Link
              href="/auth/register"
              className="text-ahava-600 font-medium hover:underline"
            >
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
