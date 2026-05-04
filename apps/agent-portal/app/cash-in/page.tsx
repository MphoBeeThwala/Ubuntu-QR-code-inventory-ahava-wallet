"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios, { AxiosInstance } from "axios";
import Sidebar from "../components/Sidebar";

type Step = "lookup" | "confirm" | "success" | "error";

interface WalletInfo {
  id: string;
  walletNumber: string;
  holderName: string;
  balanceCents: number;
  status: string;
}

function fmtZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

export default function CashInPage() {
  const router = useRouter();
  const [api, setApi] = useState<AxiosInstance | null>(null);

  const [step, setStep] = useState<Step>("lookup");
  const [walletNumber, setWalletNumber] = useState("");
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [amountRands, setAmountRands] = useState("");
  const [reference, setReference] = useState("");
  const [transactionId, setTransactionId] = useState("");

  const [lookupError, setLookupError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("agentToken");
    if (!token) {
      router.replace("/login");
      return;
    }
    setApi(
      axios.create({
        baseURL: process.env.NEXT_PUBLIC_API_URL,
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
  }, [router]);

  async function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !walletNumber.trim()) return;
    setLookupError("");
    setLookupLoading(true);
    try {
      const res = await api.get(
        `/wallets/lookup?walletNumber=${encodeURIComponent(walletNumber.trim())}`,
      );
      const w = res.data?.data?.wallet;
      setWallet({
        id: w.id,
        walletNumber: w.walletNumber,
        holderName: w.holderName ?? w.walletNumber,
        balanceCents: parseInt(w.balance ?? "0"),
        status: w.status,
      });
      setStep("confirm");
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.error?.message ?? "Wallet not found")
        : "Lookup failed";
      setLookupError(msg);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!api || !wallet) return;
    const cents = Math.round(parseFloat(amountRands) * 100);
    if (!cents || cents <= 0) {
      setSubmitError("Enter a valid amount");
      return;
    }
    setSubmitError("");
    setSubmitLoading(true);
    try {
      const res = await api.post("/agents/cash-in", {
        customerWalletId: wallet.id,
        amountCents: cents,
        reference: reference.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setTransactionId(res.data?.data?.transactionId ?? "");
      setStep("success");
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.error?.message ?? "Transaction failed")
        : "Transaction failed";
      setSubmitError(msg);
      setStep("error");
    } finally {
      setSubmitLoading(false);
    }
  }

  function reset() {
    setStep("lookup");
    setWalletNumber("");
    setWallet(null);
    setAmountRands("");
    setReference("");
    setTransactionId("");
    setLookupError("");
    setSubmitError("");
  }

  return (
    <div className="min-h-screen bg-gray-50 flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto px-8 py-8">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Cash In</h2>
          <p className="text-gray-500 text-sm mt-1">
            Load cash onto a customer&apos;s Ubuntu wallet
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-8 text-sm">
          {(["lookup", "confirm", "success"] as Step[]).map((s, i) => (
            <React.Fragment key={s}>
              <div
                className={`flex items-center gap-1.5 ${
                  step === s
                    ? "text-blue-600 font-semibold"
                    : step === "success" || (step === "confirm" && i === 0)
                      ? "text-green-600"
                      : "text-gray-300"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                    step === s
                      ? "border-blue-600 bg-blue-50 text-blue-600"
                      : step === "success" || (step === "confirm" && i === 0)
                        ? "border-green-500 bg-green-50 text-green-600"
                        : "border-gray-200 text-gray-300"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="capitalize hidden sm:inline">
                  {s === "lookup"
                    ? "Find Customer"
                    : s === "confirm"
                      ? "Confirm"
                      : "Done"}
                </span>
              </div>
              {i < 2 && <div className="flex-1 h-px bg-gray-200 max-w-16" />}
            </React.Fragment>
          ))}
        </div>

        <div className="max-w-lg">
          {/* Step 1: Lookup */}
          {step === "lookup" && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">
                Find Customer Wallet
              </h3>
              <form onSubmit={handleLookup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Wallet Number
                  </label>
                  <input
                    type="text"
                    value={walletNumber}
                    onChange={(e) => setWalletNumber(e.target.value)}
                    placeholder="AHV-XXXX-XXXX-XXXX"
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    required
                  />
                </div>
                {lookupError && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                    {lookupError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={lookupLoading || !walletNumber.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition text-sm"
                >
                  {lookupLoading ? "Searching…" : "Find Wallet →"}
                </button>
              </form>
            </div>
          )}

          {/* Step 2: Confirm amount */}
          {step === "confirm" && wallet && (
            <div className="space-y-4">
              {/* Customer card */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold">
                    {wallet.holderName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">
                      {wallet.holderName}
                    </p>
                    <p className="text-xs text-gray-400 font-mono">
                      {wallet.walletNumber}
                    </p>
                  </div>
                  <span
                    className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
                      wallet.status === "ACTIVE"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-600"
                    }`}
                  >
                    {wallet.status.toLowerCase()}
                  </span>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <p className="text-xs text-gray-500">Current balance</p>
                  <p className="text-xl font-bold text-gray-900">
                    {fmtZAR(wallet.balanceCents)}
                  </p>
                </div>
              </div>

              {/* Amount form */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">
                  Cash In Amount
                </h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Amount (ZAR)
                    </label>
                    <div className="relative">
                      <span className="absolute left-4 top-3 text-gray-500 text-sm font-medium">
                        R
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={amountRands}
                        onChange={(e) => setAmountRands(e.target.value)}
                        placeholder="0.00"
                        className="w-full border border-gray-300 rounded-xl px-4 py-3 pl-8 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      />
                    </div>
                    {amountRands && parseFloat(amountRands) > 0 && (
                      <p className="text-xs text-gray-400 mt-1">
                        New balance after:{" "}
                        <span className="font-semibold text-gray-700">
                          {fmtZAR(
                            wallet.balanceCents +
                              Math.round(parseFloat(amountRands) * 100),
                          )}
                        </span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Reference{" "}
                      <span className="text-gray-400 font-normal">
                        (optional)
                      </span>
                    </label>
                    <input
                      type="text"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="e.g. Receipt #1234"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>

                  {submitError && (
                    <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
                      {submitError}
                    </p>
                  )}

                  <div className="flex gap-3 pt-1">
                    <button
                      type="button"
                      onClick={reset}
                      className="flex-1 border border-gray-200 text-gray-600 font-medium py-3 rounded-xl text-sm hover:bg-gray-50 transition"
                    >
                      ← Back
                    </button>
                    <button
                      type="submit"
                      disabled={submitLoading || !amountRands}
                      className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-3 rounded-xl transition text-sm"
                    >
                      {submitLoading
                        ? "Processing…"
                        : `Load ${amountRands ? fmtZAR(Math.round(parseFloat(amountRands) * 100)) : "cash"}`}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Step 3: Success */}
          {step === "success" && wallet && (
            <div className="bg-white rounded-2xl shadow-sm border border-green-100 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl mx-auto mb-4">
                ✓
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">
                Cash In Successful
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                {fmtZAR(Math.round(parseFloat(amountRands) * 100))} loaded onto{" "}
                {wallet.holderName}&apos;s wallet
              </p>
              {transactionId && (
                <p className="text-xs text-gray-400 font-mono bg-gray-50 rounded-lg px-3 py-2 mb-6">
                  Txn: {transactionId}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={reset}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition"
                >
                  New Cash In
                </button>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="flex-1 border border-gray-200 text-gray-600 font-medium py-3 rounded-xl text-sm hover:bg-gray-50 transition"
                >
                  Dashboard
                </button>
              </div>
            </div>
          )}

          {/* Error state */}
          {step === "error" && (
            <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 text-center">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center text-3xl mx-auto mb-4">
                ✕
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-1">
                Transaction Failed
              </h3>
              <p className="text-red-600 text-sm mb-6">{submitError}</p>
              <button
                onClick={() => setStep("confirm")}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
