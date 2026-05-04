"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";

type ReceiveMode = "STATIC" | "DYNAMIC";

type GeneratedQr = {
  qrId: string;
  qrHash: string;
  deepLink: string;
  qrType: string;
  amountCents: number | null;
  expiresAt: string | null;
};

function fmtZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

export default function MerchantReceivePage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<ReceiveMode>("STATIC");
  const [amountRands, setAmountRands] = useState("");
  const [description, setDescription] = useState(
    "Ubuntu merchant payment for goods and services",
  );
  const [walletNumber, setWalletNumber] = useState("");
  const [qrData, setQrData] = useState<GeneratedQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    const refreshToken = localStorage.getItem("refreshToken") ?? "";
    const walletId = localStorage.getItem("walletId");
    const storedWalletNumber = localStorage.getItem("walletNumber") ?? "";

    if (!token || !walletId) {
      router.replace("/auth/login");
      return;
    }

    apiClient.setTokens(token, refreshToken);
    setWalletNumber(storedWalletNumber);
    setLoading(false);
  }, [router]);

  async function renderQr(content: string) {
    try {
      const QRCode = (await import("qrcode")).default;
      const canvas = canvasRef.current;
      if (!canvas) return;
      await QRCode.toCanvas(canvas, content, {
        width: 280,
        margin: 2,
        color: { dark: "#111827", light: "#ffffff" },
      });
    } catch {
      setError("Failed to render QR code");
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();

    const walletId = localStorage.getItem("walletId");
    if (!walletId) {
      router.replace("/auth/login");
      return;
    }

    const normalizedDescription = description.trim();
    const amountCents =
      mode === "DYNAMIC" ? Math.round(parseFloat(amountRands || "0") * 100) : 0;

    if (mode === "DYNAMIC" && amountCents <= 0) {
      setError("Enter a fixed amount above R0.00");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const response = await apiClient.generateQr(
        walletId,
        mode,
        mode === "DYNAMIC" ? amountCents : undefined,
        normalizedDescription || undefined,
      );

      if (!response.success || !response.data) {
        setError(response.error?.message ?? "Failed to generate merchant QR");
        return;
      }

      setQrData(response.data);
      await renderQr(response.data.deepLink);
    } catch {
      setError("Failed to generate merchant QR");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!qrData) return;
    try {
      await navigator.clipboard.writeText(qrData.deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy QR link");
    }
  }

  async function handleShare() {
    if (!qrData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "ubuntu-merchant-qr.png", {
        type: "image/png",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Ubuntu merchant payment",
          text:
            qrData.amountCents !== null
              ? `Scan to pay ${fmtZAR(qrData.amountCents)}`
              : `Scan to pay ${walletNumber}`,
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "ubuntu-merchant-qr.png";
        anchor.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  const previewAmount =
    mode === "DYNAMIC" && amountRands
      ? fmtZAR(Math.round(parseFloat(amountRands || "0") * 100))
      : "Open amount";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#14532d,transparent_38%),linear-gradient(180deg,#0f172a_0%,#111827_100%)] text-white">
      <div className="mx-auto max-w-5xl px-4 pb-12 pt-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="rounded-full border border-white/15 bg-white/5 p-2 text-white/70 transition hover:text-white"
              aria-label="Back"
            >
              <svg
                className="h-5 w-5"
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
            <div>
              <p className="text-sm uppercase tracking-[0.24em] text-emerald-300/80">
                Merchant Receive
              </p>
              <h1 className="text-2xl font-bold">Accept QR payments</h1>
            </div>
          </div>

          <Link
            href="/wallet/history"
            className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            View transactions
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-[28px] border border-white/10 bg-white/5 p-5 shadow-2xl backdrop-blur">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-white/55">Wallet number</p>
                <p className="font-mono text-sm font-semibold text-white/90">
                  {walletNumber || "Loading..."}
                </p>
              </div>
              <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                Merchant QR
              </div>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-3">
              {(
                [
                  {
                    value: "STATIC",
                    title: "Open amount",
                    caption: "Customer chooses the amount",
                  },
                  {
                    value: "DYNAMIC",
                    title: "Fixed amount",
                    caption: "Lock the exact sale amount",
                  },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setMode(option.value);
                    setError("");
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    mode === option.value
                      ? "border-emerald-300 bg-emerald-400/15"
                      : "border-white/10 bg-black/10 hover:bg-white/5"
                  }`}
                >
                  <p className="font-semibold text-white">{option.title}</p>
                  <p className="mt-1 text-sm text-white/55">{option.caption}</p>
                </button>
              ))}
            </div>

            <form onSubmit={handleGenerate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/70">
                  Sale note
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Groceries, transport, school fees"
                  className="w-full rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-white placeholder:text-white/30 focus:border-emerald-300 focus:outline-none"
                  maxLength={80}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/70">
                  Amount
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3.5 text-sm text-white/45">
                    R
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amountRands}
                    onChange={(e) => setAmountRands(e.target.value)}
                    disabled={mode === "STATIC"}
                    placeholder="0.00"
                    className="w-full rounded-2xl border border-white/10 bg-black/10 px-4 py-3 pl-8 text-white placeholder:text-white/30 focus:border-emerald-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </div>
                <p className="mt-1.5 text-xs text-white/45">
                  {mode === "STATIC"
                    ? "Your customer will enter the amount when they scan."
                    : "Use a fixed amount for a live sale or investor demo."}
                </p>
              </div>

              {error && (
                <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || submitting}
                className="w-full rounded-2xl bg-emerald-400 px-4 py-3.5 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Generating..." : "Generate merchant QR"}
              </button>
            </form>
          </section>

          <section className="rounded-[28px] border border-white/10 bg-[#f8fafc] p-5 text-slate-900 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-slate-500">
                  Payment Preview
                </p>
                <h2 className="mt-1 text-2xl font-bold">Ubuntu merchant QR</h2>
              </div>
              <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                {mode === "STATIC" ? "Open amount" : "Fixed amount"}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">
                    Mama Thandi style flow
                  </p>
                  <p className="text-xs text-slate-500">
                    Built for merchant acceptance and demo walkthroughs
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-slate-400">
                    Amount
                  </p>
                  <p className="text-lg font-bold text-emerald-700">
                    {previewAmount}
                  </p>
                </div>
              </div>

              <div className="flex justify-center rounded-[24px] bg-slate-50 p-4">
                <canvas ref={canvasRef} className="rounded-xl" />
              </div>

              <div className="mt-4 space-y-2 text-sm">
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Wallet</span>
                  <span className="font-mono text-xs font-semibold">
                    {walletNumber || "Loading..."}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2">
                  <span className="text-slate-500">Sale note</span>
                  <span className="max-w-[60%] truncate text-right font-medium">
                    {description || "Merchant payment"}
                  </span>
                </div>
                {qrData?.expiresAt && (
                  <div className="flex items-center justify-between rounded-2xl bg-amber-50 px-3 py-2 text-amber-700">
                    <span>Expires</span>
                    <span className="font-medium">
                      {new Date(qrData.expiresAt).toLocaleTimeString("en-ZA", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleShare}
                disabled={!qrData}
                className="rounded-2xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Share QR
              </button>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!qrData}
                className="rounded-2xl border border-slate-200 px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {copied ? "Copied" : "Copy payment link"}
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
              Use this screen in the investor demo to show a merchant creating a
              QR, then switch to scan-and-pay from the customer wallet.
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
