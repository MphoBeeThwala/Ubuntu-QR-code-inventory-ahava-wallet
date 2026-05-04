"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";

interface QrData {
  qrHash: string;
  deepLink: string;
  walletNumber: string;
}

export default function MyQrPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    const walletId = localStorage.getItem("walletId");
    const walletNumber = localStorage.getItem("walletNumber") ?? "";
    if (!token || !walletId) {
      router.replace("/auth/login");
      return;
    }
    apiClient.setTokens(token, localStorage.getItem("refreshToken") ?? "");

    // Check for a cached static QR hash first to avoid extra API calls
    const cachedHash = localStorage.getItem("staticQrHash");
    if (cachedHash) {
      const deepLink = `ubuntu://pay?qr=${cachedHash}`;
      setQrData({ qrHash: cachedHash, deepLink, walletNumber });
      renderQr(deepLink);
      setLoading(false);
      return;
    }

    apiClient
      .generateQr(walletId, "STATIC")
      .then((res) => {
        if (res.success && res.data) {
          const { qrHash, deepLink } = res.data;
          localStorage.setItem("staticQrHash", qrHash);
          setQrData({ qrHash, deepLink, walletNumber });
          renderQr(deepLink);
        } else {
          setError(res.error?.message ?? "Failed to generate QR code");
        }
      })
      .catch(() => setError("Failed to generate QR code"))
      .finally(() => setLoading(false));
  }, [router]);

  async function renderQr(content: string) {
    try {
      const QRCode = (await import("qrcode")).default;
      const canvas = canvasRef.current;
      if (!canvas) return;
      await QRCode.toCanvas(canvas, content, {
        width: 260,
        margin: 2,
        color: { dark: "#0f172a", light: "#ffffff" },
      });
    } catch {
      setError("Failed to render QR code");
    }
  }

  async function handleCopy() {
    if (!qrData) return;
    try {
      await navigator.clipboard.writeText(qrData.deepLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
  }

  async function handleShare() {
    if (!qrData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "ubuntu-qr.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Pay me via Ubuntu",
          text: `Scan to pay ${qrData.walletNumber}`,
          files: [file],
        });
      } else {
        // Fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ubuntu-qr.png";
        a.click();
        URL.revokeObjectURL(url);
      }
    });
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-ahava-700 to-ahava-900 text-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 pt-10 pb-4">
        <button
          onClick={() => router.back()}
          className="text-white/70 hover:text-white transition p-1"
          aria-label="Back"
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
        <h1 className="font-semibold text-lg">My QR Code</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-10">
        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-64 h-64 rounded-3xl bg-white/10 animate-pulse" />
            <p className="text-white/50 text-sm">Generating your QR code…</p>
          </div>
        ) : error ? (
          <div className="text-center">
            <p className="text-4xl mb-4">⚠️</p>
            <p className="text-red-300 text-sm mb-5">{error}</p>
            <button
              onClick={() => router.replace("/wallet/qr")}
              className="bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-xl text-sm transition"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* QR card */}
            <div className="bg-white rounded-3xl p-5 shadow-2xl mb-6 flex flex-col items-center">
              <canvas ref={canvasRef} className="rounded-xl" />
              <div className="mt-4 text-center">
                <p className="text-gray-500 text-xs font-medium uppercase tracking-wide">
                  Wallet Number
                </p>
                <p className="text-gray-900 font-mono font-bold text-sm mt-0.5">
                  {qrData?.walletNumber}
                </p>
              </div>
            </div>

            <p className="text-white/60 text-sm text-center mb-8 max-w-xs">
              Ask someone to scan this code with their Ubuntu app to pay you
            </p>

            {/* Action buttons */}
            <div className="w-full max-w-xs space-y-3">
              <button
                onClick={handleShare}
                className="w-full bg-white text-ahava-700 font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 hover:bg-white/90 transition"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342
                       m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316
                       m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
                Share QR Code
              </button>

              <button
                onClick={handleCopy}
                className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 transition"
              >
                {copied ? (
                  <>
                    <svg
                      className="w-4 h-4 text-green-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-green-400">Copied!</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2
                           m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy Link
                  </>
                )}
              </button>

              <button
                onClick={() => router.push("/dashboard")}
                className="w-full text-white/40 hover:text-white text-sm py-2 transition"
              >
                Back to Dashboard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
