"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";

export default function RegisterPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [deviceId] = useState(() =>
    typeof window !== "undefined"
      ? localStorage.getItem("deviceId") || crypto.randomUUID()
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleaned = phone.replace(/\s/g, "");
    if (!/^(\+27|0)[6-8]\d{8}$/.test(cleaned)) {
      setError("Enter a valid South African mobile number (e.g. 0831234567)");
      return;
    }
    if (pin.length < 5) {
      setError("PIN must be 5–6 digits");
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs do not match");
      return;
    }

    setLoading(true);
    try {
      const res = await apiClient.register(cleaned, pin);
      if (res.success && res.data) {
        localStorage.setItem("accessToken", res.data.accessToken);
        localStorage.setItem("deviceId", deviceId);
        router.replace("/dashboard");
      } else {
        setError(res.error?.message || "Registration failed");
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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white">Ahava</h1>
          <p className="text-ahava-200 mt-1 text-sm">
            South African Digital Wallet
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">
            Create account
          </h2>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First name
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Mpho"
                  className="input-field"
                  autoComplete="given-name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last name
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Mokoena"
                  className="input-field"
                  autoComplete="family-name"
                  required
                />
              </div>
            </div>

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
              />
              <p className="text-xs text-gray-400 mt-1">
                South African numbers only
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Create PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="5–6 digit PIN"
                className="input-field tracking-widest"
                inputMode="numeric"
                maxLength={6}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Confirm PIN
              </label>
              <input
                type="password"
                value={confirmPin}
                onChange={(e) =>
                  setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Repeat PIN"
                className="input-field tracking-widest"
                inputMode="numeric"
                maxLength={6}
                required
              />
            </div>

            <p className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3">
              By creating an account you agree to Ahava's{" "}
              <a href="#" className="text-ahava-600 hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="text-ahava-600 hover:underline">
                Privacy Policy
              </a>
              . Your data is protected under POPIA.
            </p>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{" "}
            <Link
              href="/auth/login"
              className="text-ahava-600 font-medium hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
