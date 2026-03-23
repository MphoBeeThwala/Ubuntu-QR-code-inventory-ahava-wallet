"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { v4 as uuidv4 } from "uuid";

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="page-header">
        {step === "entry" ? (
          <Link href="/dashboard" className="text-gray-500 hover:text-gray-700">
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
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
            className="text-gray-500 hover:text-gray-700"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
        ) : null}
        <h1 className="font-bold text-gray-900">Send Money</h1>
      </div>

      <div className="max-w-sm mx-auto px-4 py-6">
        {/* ── ENTRY ── */}
        {step === "entry" && (
          <form onSubmit={handleContinue} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="card">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recipient phone number
              </label>
              <input
                type="tel"
                value={draft.recipient}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, recipient: e.target.value }))
                }
                placeholder="0831234567"
                className="input-field"
                inputMode="tel"
                required
              />
              <p className="text-xs text-gray-400 mt-1">
                Must be a registered Ahava user
              </p>
            </div>

            <div className="card">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount (ZAR)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-semibold">
                  R
                </span>
                <input
                  type="number"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="0.00"
                  className="input-field pl-8"
                  inputMode="decimal"
                  min="1"
                  step="0.01"
                  required
                />
              </div>
              {amountInput && parseFloat(amountInput) >= 1 && (
                <p className="text-xs text-gray-400 mt-1">
                  Fee:{" "}
                  {fmtZAR(
                    Math.max(
                      25,
                      Math.round(parseFloat(amountInput) * 100 * 0.005),
                    ),
                  )}{" "}
                  · Total:{" "}
                  {fmtZAR(
                    Math.round(parseFloat(amountInput) * 100) +
                      Math.max(
                        25,
                        Math.round(parseFloat(amountInput) * 100 * 0.005),
                      ),
                  )}
                </p>
              )}
            </div>

            <div className="card">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400">(optional)</span>
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

            <button type="submit" className="btn-primary">
              Continue
            </button>
          </form>
        )}

        {/* ── CONFIRM ── */}
        {step === "confirm" && (
          <div className="space-y-4">
            <div className="card space-y-3">
              <h2 className="font-bold text-gray-900">Confirm payment</h2>
              {[
                { label: "To", value: draft.recipient },
                { label: "Amount", value: fmtZAR(draft.amountCents) },
                { label: "Fee (0.5%)", value: fmtZAR(feeCents) },
                { label: "Total deducted", value: fmtZAR(totalCents) },
                ...(draft.description
                  ? [{ label: "Description", value: draft.description }]
                  : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-medium text-gray-900">{value}</span>
                </div>
              ))}
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handleConfirm}
              className="btn-primary"
              disabled={loading}
            >
              {loading ? "Sending…" : `Send ${fmtZAR(draft.amountCents)}`}
            </button>
            <button
              onClick={() => setStep("entry")}
              className="btn-secondary"
              disabled={loading}
            >
              Edit details
            </button>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {step === "success" && (
          <div className="text-center py-10 space-y-4">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-10 h-10 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Payment sent!</h2>
            <p className="text-gray-500">
              {fmtZAR(draft.amountCents)} sent to {draft.recipient}
            </p>
            <p className="text-xs text-gray-400 font-mono">{transactionId}</p>
            <button
              onClick={() => router.replace("/dashboard")}
              className="btn-primary mt-4"
            >
              Back to dashboard
            </button>
          </div>
        )}

        {/* ── ERROR ── */}
        {step === "error" && (
          <div className="text-center py-10 space-y-4">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto">
              <svg
                className="w-10 h-10 text-red-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900">Payment failed</h2>
            <p className="text-gray-500 text-sm">{error}</p>
            <button
              onClick={() => {
                setStep("confirm");
                setError("");
              }}
              className="btn-primary"
            >
              Try again
            </button>
            <button
              onClick={() => router.replace("/dashboard")}
              className="btn-secondary"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
