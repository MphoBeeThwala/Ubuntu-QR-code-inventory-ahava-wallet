"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { v4 as uuidv4 } from "uuid";
import { motion, AnimatePresence } from "framer-motion";

type Step = "entry" | "confirm" | "success" | "error";

interface PaymentDraft {
  recipient: string;
  amountCents: number;
  description: string;
}

function fmtZAR(cents: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export default function SendMoneyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("entry");
  const [draft, setDraft] = useState<PaymentDraft>({
    recipient: "",
    amountCents: 0,
    description: "",
  });
  const [amountInput, setAmountInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transactionId, setTransactionId] = useState("");

  const feeCents = Math.max(25, Math.round(draft.amountCents * 0.005));
  const totalCents = draft.amountCents + feeCents;

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const cleaned = draft.recipient.replace(/\s/g, "");
    if (!cleaned) {
      setError("Recipient is required");
      return;
    }

    const parsed = parseFloat(amountInput);
    if (isNaN(parsed) || parsed < 1) {
      setError("Minimum amount is R1.00");
      return;
    }
    if (parsed > 50000) {
      setError("Maximum single transfer is R50 000");
      return;
    }

    setDraft((d) => ({ ...d, amountCents: Math.round(parsed * 100) }));
    setStep("confirm");
  };

  const handleConfirm = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiClient.sendPayment(
        draft.recipient,
        draft.amountCents,
        draft.description,
      );
      if (res.success && res.data) {
        setTransactionId(res.data.transactionId || uuidv4());
        setStep("success");
      } else {
        setError(res.error?.message || "Payment failed");
        setStep("error");
      }
    } catch {
      setError("Network error — payment was NOT sent. Please try again.");
      setStep("error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="page-header">
        {step === "entry" ? (
          <Link
            href="/dashboard"
            className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-full text-gray-600 hover:bg-gray-200 transition"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
        ) : step !== "success" ? (
          <button
            onClick={() => {
              setStep("entry");
              setError("");
            }}
            className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-full text-gray-600 hover:bg-gray-200 transition"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        ) : (
          <div className="w-10 h-10" />
        )}
        <h1 className="flex-1 text-center font-bold text-lg text-gray-900 pr-10">
          Send Money
        </h1>
      </div>

      <div className="max-w-md mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {/* ── ENTRY ── */}
          {step === "entry" && (
            <motion.form
              key="entry"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              onSubmit={handleContinue}
              className="space-y-4"
            >
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center gap-3"
                >
                  <span className="text-red-500 text-lg">⚠</span>
                  {error}
                </motion.div>
              )}

              <div className="card space-y-2">
                <label className="block text-sm font-bold text-gray-700 pl-1">
                  Recipient phone or wallet number
                </label>
                <input
                  type="tel"
                  value={draft.recipient}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, recipient: e.target.value }))
                  }
                  placeholder="083 123 4567 or AHV-XXXX-XXXX-XXXX"
                  className="input-field text-lg font-medium"
                  inputMode="tel"
                  required
                />
                <p className="text-xs text-gray-500 pl-1">
                  Must be a registered Ubuntu user or wallet
                </p>
              </div>

              <div className="card space-y-2">
                <label className="block text-sm font-bold text-gray-700 pl-1">
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xl">
                    R
                  </span>
                  <input
                    type="number"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    placeholder="0.00"
                    className="input-field pl-10 text-2xl font-bold"
                    inputMode="decimal"
                    min="1"
                    step="0.01"
                    required
                  />
                </div>
                {amountInput && parseFloat(amountInput) >= 1 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-between items-center text-xs bg-gray-50 p-3 rounded-xl mt-2 border border-gray-100"
                  >
                    <span className="text-gray-500 font-medium">
                      Fee (0.5%):{" "}
                      <span className="text-gray-900">
                        {fmtZAR(
                          Math.max(
                            25,
                            Math.round(parseFloat(amountInput) * 100 * 0.005),
                          ),
                        )}
                      </span>
                    </span>
                    <span className="text-ahava-600 font-bold">
                      Total:{" "}
                      {fmtZAR(
                        Math.round(parseFloat(amountInput) * 100) +
                          Math.max(
                            25,
                            Math.round(parseFloat(amountInput) * 100 * 0.005),
                          ),
                      )}
                    </span>
                  </motion.div>
                )}
              </div>

              <div className="card space-y-2">
                <label className="block text-sm font-bold text-gray-700 pl-1">
                  Description{" "}
                  <span className="text-gray-400 font-medium">(optional)</span>
                </label>
                <input
                  type="text"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  placeholder="e.g. Rent, lunch"
                  className="input-field"
                  maxLength={100}
                />
              </div>

              <button type="submit" className="btn-primary mt-6 h-14 text-lg">
                Continue
              </button>
            </motion.form>
          )}

          {/* ── CONFIRM ── */}
          {step === "confirm" && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="text-center space-y-2 mt-4 mb-8">
                <p className="text-gray-500 font-medium">You are sending</p>
                <h2 className="text-5xl font-bold text-gray-900 tracking-tight">
                  {fmtZAR(draft.amountCents)}
                </h2>
                <div className="inline-block bg-ahava-50 text-ahava-700 px-4 py-1.5 rounded-full text-sm font-bold mt-2 border border-ahava-100">
                  To: {draft.recipient}
                </div>
              </div>

              <div className="card space-y-4">
                <h3 className="font-bold text-gray-900 border-b border-gray-100 pb-3">
                  Payment Summary
                </h3>
                {[
                  { label: "Amount", value: fmtZAR(draft.amountCents) },
                  { label: "Fee (0.5%)", value: fmtZAR(feeCents) },
                  {
                    label: "Total Deducted",
                    value: fmtZAR(totalCents),
                    bold: true,
                  },
                  ...(draft.description
                    ? [{ label: "Note", value: draft.description }]
                    : []),
                ].map(({ label, value, bold }) => (
                  <div
                    key={label}
                    className="flex justify-between items-center text-sm"
                  >
                    <span className="text-gray-500 font-medium">{label}</span>
                    <span
                      className={`${bold ? "font-bold text-lg text-gray-900" : "font-semibold text-gray-700"}`}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 font-medium flex items-center gap-3">
                  <span className="text-red-500 text-lg">⚠</span>
                  {error}
                </div>
              )}

              <div className="space-y-3 pt-4">
                <button
                  onClick={handleConfirm}
                  className="btn-primary h-14 text-lg"
                  disabled={loading}
                >
                  {loading ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Processing...</span>
                    </div>
                  ) : (
                    "Confirm Payment"
                  )}
                </button>
                <button
                  onClick={() => setStep("entry")}
                  className="btn-secondary h-14 text-lg"
                  disabled={loading}
                >
                  Edit details
                </button>
              </div>
            </motion.div>
          )}

          {/* ── SUCCESS ── */}
          {step === "success" && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-8 space-y-6"
            >
              <div className="relative w-24 h-24 mx-auto">
                <div className="absolute inset-0 bg-green-100 rounded-full animate-ping opacity-75"></div>
                <div className="relative w-24 h-24 bg-green-500 rounded-full flex items-center justify-center shadow-lg shadow-green-200">
                  <svg
                    className="w-12 h-12 text-white"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              </div>

              <div>
                <h2 className="text-3xl font-bold text-gray-900 tracking-tight">
                  Payment Sent!
                </h2>
                <p className="text-gray-500 mt-2 font-medium">
                  Your transaction was successful.
                </p>
              </div>

              <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 mb-8 text-left relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-ahava-400 to-ahava-600"></div>
                <p className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Amount Sent
                </p>
                <p className="text-4xl font-bold text-gray-900 mb-6">
                  {fmtZAR(draft.amountCents)}
                </p>

                <div className="space-y-4 border-t border-dashed border-gray-200 pt-6">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500 font-medium">To</span>
                    <span className="font-bold text-gray-900">
                      {draft.recipient}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-gray-500 font-medium">Ref</span>
                    <span className="font-mono font-bold text-gray-600 bg-gray-50 px-2 py-1 rounded-md">
                      {transactionId.slice(0, 8).toUpperCase()}
                    </span>
                  </div>
                  {draft.description && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-gray-500 font-medium">Note</span>
                      <span className="font-medium text-gray-900">
                        {draft.description}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator
                        .share({
                          title: "Ubuntu Payment Receipt",
                          text: `Proof of Payment: ${fmtZAR(draft.amountCents)} sent to ${draft.recipient}. Ref: ${transactionId.slice(0, 8).toUpperCase()}`,
                        })
                        .catch(console.error);
                    } else {
                      alert("Sharing not supported on this browser");
                    }
                  }}
                  className="w-full bg-ahava-50 text-ahava-700 font-bold py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-ahava-100 transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                    />
                  </svg>
                  Share Receipt
                </button>
                <button
                  onClick={() => router.replace("/dashboard")}
                  className="btn-primary h-14 text-lg"
                >
                  Done
                </button>
              </div>
            </motion.div>
          )}

          {/* ── ERROR ── */}
          {step === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-10 space-y-6"
            >
              <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                <svg
                  className="w-12 h-12 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
                  Payment failed
                </h2>
                <p className="text-gray-500 font-medium mt-2">{error}</p>
              </div>
              <div className="space-y-3 pt-6">
                <button
                  onClick={() => {
                    setStep("confirm");
                    setError("");
                  }}
                  className="btn-primary h-14 text-lg"
                >
                  Try again
                </button>
                <button
                  onClick={() => router.replace("/dashboard")}
                  className="btn-secondary h-14 text-lg"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
