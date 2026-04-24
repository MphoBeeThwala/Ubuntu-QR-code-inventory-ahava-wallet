"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuidv4 } from "uuid";
import { apiClient } from "@/lib/api-client";

type Step = "scanning" | "confirm" | "processing" | "success" | "error";

interface QrInfo {
  qrHash: string;
  qrType: string;
  recipientName: string | null;
  walletNumber: string;
  walletType: string;
  amountCents: number | null;
  currency: string;
  description: string | null;
  expiresAt: string | null;
}

function fmtZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

export default function ScanQrPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const startCameraRef = useRef<() => Promise<void>>(async () => {});

  const [step, setStep] = useState<Step>("scanning");
  const [cameraError, setCameraError] = useState("");
  const [torchOn, setTorchOn] = useState(false);
  const [qrInfo, setQrInfo] = useState<QrInfo | null>(null);
  const [amountRands, setAmountRands] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [txId, setTxId] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const walletId =
    typeof window !== "undefined"
      ? (localStorage.getItem("walletId") ?? "")
      : "";

  const payeeDisplayName =
    qrInfo?.recipientName ??
    (qrInfo?.walletType === "MERCHANT" ? "Merchant" : "Ubuntu user");

  // ── Stop camera ───────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // ── Handle a decoded QR string ────────────────────────────────
  const handleDecoded = useCallback(
    async (raw: string) => {
      stopCamera();

      // Parse ubuntu://pay?qr=<hash> and older ahava://pay?qr=<hash>,
      // or treat raw as the hash directly.
      let qrHash = raw;
      try {
        const url = new URL(raw);
        if (url.protocol === "ubuntu:" || url.protocol === "ahava:") {
          qrHash = url.searchParams.get("qr") ?? raw;
        }
      } catch {
        // not a URL — use raw
      }

      setLookupError("");
      setStep("confirm"); // show skeleton while loading

      try {
        const token = localStorage.getItem("accessToken") ?? "";
        apiClient.setTokens(token, localStorage.getItem("refreshToken") ?? "");
        const res = await apiClient.lookupQr(qrHash);
        if (!res.success || !res.data) {
          setLookupError(res.error?.message ?? "QR code not found");
          setStep("scanning");
          void startCameraRef.current();
          return;
        }
        setQrInfo({ qrHash, ...res.data });
        if (res.data.amountCents !== null) {
          setAmountRands((res.data.amountCents / 100).toFixed(2));
        }
        setStep("confirm");
      } catch {
        setLookupError("Failed to look up QR code");
        setStep("scanning");
        void startCameraRef.current();
      }
    },
    [stopCamera],
  );

  // ── Start camera + scan loop ──────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const scan = async () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || video.readyState < 2) {
          rafRef.current = requestAnimationFrame(scan);
          return;
        }
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        // Dynamic import to avoid SSR issues
        const jsQR = (await import("jsqr")).default;
        const code = jsQR(imgData.data, imgData.width, imgData.height);
        if (code?.data) {
          handleDecoded(code.data);
          return;
        }
        rafRef.current = requestAnimationFrame(scan);
      };
      rafRef.current = requestAnimationFrame(scan);
    } catch (err) {
      const e = err as Error;
      setCameraError(
        e.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access and try again."
          : "Unable to start camera. Try using a different browser.",
      );
    }
  }, [handleDecoded]);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.replace("/auth/login");
      return;
    }
    startCameraRef.current = startCamera;
  }, [router, startCamera]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [router, startCamera, stopCamera]);

  // ── Toggle torch ──────────────────────────────────────────────
  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        // @ts-expect-error — torch is not in standard TS types yet
        advanced: [{ torch: !torchOn }],
      });
      setTorchOn((v) => !v);
    } catch {
      // torch not supported
    }
  };

  // ── Pay via QR ────────────────────────────────────────────────
  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    if (!qrInfo || !walletId) return;
    const cents = Math.round(parseFloat(amountRands) * 100);
    if (!cents || cents <= 0) return;
    setStep("processing");
    try {
      const res = await apiClient.payViaQr(
        qrInfo.qrHash,
        walletId,
        cents,
        uuidv4(),
      );
      if (res.success && res.data) {
        setTxId(res.data.transactionId);
        setStep("success");
      } else {
        setErrorMsg(res.error?.message ?? "Payment failed");
        setStep("error");
      }
    } catch {
      setErrorMsg("Payment failed. Please try again.");
      setStep("error");
    }
  }

  function retryCamera() {
    setStep("scanning");
    setQrInfo(null);
    setAmountRands("");
    setLookupError("");
    setErrorMsg("");
    startCamera();
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-4 pt-10 pb-4 z-10">
        <button
          onClick={() => {
            stopCamera();
            router.back();
          }}
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
        <h1 className="font-semibold text-lg">
          {step === "scanning"
            ? "Scan QR Code"
            : step === "confirm"
              ? "Confirm Payment"
              : step === "processing"
                ? "Processing…"
                : step === "success"
                  ? "Payment Sent"
                  : "Payment Failed"}
        </h1>
        {step === "scanning" && (
          <button
            onClick={toggleTorch}
            className={`ml-auto p-2 rounded-full transition ${torchOn ? "bg-yellow-400 text-gray-900" : "bg-white/10 text-white"}`}
            aria-label="Toggle torch"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 2l-1 7H4l8 13 1-8h4L9 2z" />
            </svg>
          </button>
        )}
      </div>

      {/* ── SCANNING step ── */}
      {step === "scanning" && (
        <div className="flex-1 flex flex-col items-center justify-center">
          {cameraError ? (
            <div className="px-6 text-center">
              <p className="text-4xl mb-4">📷</p>
              <p className="text-red-400 text-sm mb-4">{cameraError}</p>
              <button
                onClick={() => startCamera()}
                className="bg-ahava-600 hover:bg-ahava-700 text-white font-semibold px-6 py-3 rounded-xl text-sm transition"
              >
                Try Again
              </button>
            </div>
          ) : (
            <div className="relative w-full max-w-sm mx-auto">
              {/* Video feed */}
              <video
                ref={videoRef}
                className="w-full rounded-2xl object-cover"
                playsInline
                muted
              />
              {/* Hidden canvas for frame extraction */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Viewfinder overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-56 h-56 relative">
                  {/* Corner brackets */}
                  {[
                    "top-0 left-0 border-t-4 border-l-4 rounded-tl-xl",
                    "top-0 right-0 border-t-4 border-r-4 rounded-tr-xl",
                    "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-xl",
                    "bottom-0 right-0 border-b-4 border-r-4 rounded-br-xl",
                  ].map((cls, i) => (
                    <div
                      key={i}
                      className={`absolute w-8 h-8 border-white/80 ${cls}`}
                    />
                  ))}
                  {/* Scanning line animation */}
                  <div className="absolute inset-x-0 top-1/2 h-0.5 bg-ahava-400/70 animate-pulse" />
                </div>
              </div>

              {lookupError && (
                <div className="mt-3 mx-2 bg-red-900/60 rounded-xl px-4 py-2 text-center">
                  <p className="text-red-300 text-sm">{lookupError}</p>
                </div>
              )}
            </div>
          )}
          <p className="text-white/50 text-sm mt-5 text-center px-8">
            Point the camera at a Ubuntu QR code to pay
          </p>
        </div>
      )}

      {/* ── CONFIRM step ── */}
      {(step === "confirm" || step === "processing") && qrInfo && (
        <div className="flex-1 px-5 pt-2 pb-8">
          {/* Recipient */}
          <div className="bg-white/5 rounded-2xl p-4 mb-4">
            <p className="text-white/50 text-xs mb-1">Paying</p>
            <p className="text-white font-semibold text-lg">
              {payeeDisplayName}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                {qrInfo.walletType === "MERCHANT" ? "Merchant QR" : "Wallet QR"}
              </span>
              <p className="font-mono text-white/70 text-xs">
                {qrInfo.walletNumber}
              </p>
            </div>
            {qrInfo.description && (
              <p className="text-white/60 text-sm mt-1">{qrInfo.description}</p>
            )}
            {qrInfo.expiresAt && (
              <p className="text-amber-400 text-xs mt-2">
                Expires{" "}
                {new Date(qrInfo.expiresAt).toLocaleTimeString("en-ZA", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>

          <form onSubmit={handlePay} className="space-y-4">
            <div>
              <label className="block text-white/70 text-sm font-medium mb-1.5">
                Amount (ZAR)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-3.5 text-white/50 text-sm font-medium">
                  R
                </span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amountRands}
                  onChange={(e) => setAmountRands(e.target.value)}
                  disabled={
                    qrInfo.qrType === "DYNAMIC" && qrInfo.amountCents !== null
                  }
                  placeholder="0.00"
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3.5 pl-8 text-xl font-bold text-white
                    focus:outline-none focus:ring-2 focus:ring-ahava-400 focus:border-transparent
                    disabled:opacity-60 placeholder:text-white/30"
                  required
                />
              </div>
              {qrInfo.qrType === "DYNAMIC" && qrInfo.amountCents !== null && (
                <p className="text-white/40 text-xs mt-1">
                  Amount fixed by QR code
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={step === "processing" || !amountRands}
              className="w-full bg-ahava-600 hover:bg-ahava-700 disabled:bg-white/10 disabled:text-white/30
                text-white font-bold py-4 rounded-2xl text-base transition"
            >
              {step === "processing" ? (
                <span className="flex items-center justify-center gap-2">
                  <svg
                    className="animate-spin w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Processing…
                </span>
              ) : (
                `Pay ${amountRands ? fmtZAR(Math.round(parseFloat(amountRands) * 100)) : ""}`
              )}
            </button>

            {step !== "processing" && (
              <button
                type="button"
                onClick={retryCamera}
                className="w-full text-white/50 hover:text-white text-sm py-2 transition"
              >
                ← Scan a different code
              </button>
            )}
          </form>
        </div>
      )}

      {/* ── SUCCESS step ── */}
      {step === "success" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-5">
            <svg
              className="w-10 h-10 text-green-400"
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
          <h2 className="text-2xl font-bold mb-2">Sent!</h2>
          <p className="text-white/60 text-sm mb-2">
            {fmtZAR(Math.round(parseFloat(amountRands) * 100))} sent to{" "}
            {payeeDisplayName}
          </p>
          {txId && (
            <p className="text-white/30 text-xs font-mono bg-white/5 rounded-lg px-3 py-1.5 mb-8">
              {txId}
            </p>
          )}
          <div className="w-full space-y-3">
            <button
              onClick={retryCamera}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3.5 rounded-2xl text-sm transition"
            >
              Scan Another
            </button>
            <button
              onClick={() => {
                stopCamera();
                router.push("/dashboard");
              }}
              className="w-full bg-ahava-600 hover:bg-ahava-700 text-white font-bold py-3.5 rounded-2xl text-sm transition"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR step ── */}
      {step === "error" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-5">
            <svg
              className="w-10 h-10 text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold mb-2">Payment Failed</h2>
          <p className="text-red-400 text-sm mb-8">{errorMsg}</p>
          <div className="w-full space-y-3">
            <button
              onClick={() => setStep("confirm")}
              className="w-full bg-ahava-600 hover:bg-ahava-700 text-white font-bold py-3.5 rounded-2xl text-sm transition"
            >
              Try Again
            </button>
            <button
              onClick={retryCamera}
              className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3.5 rounded-2xl text-sm transition"
            >
              Scan New Code
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
