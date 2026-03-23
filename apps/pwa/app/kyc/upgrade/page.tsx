"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";

type KycTier = "KYC_TIER_0" | "KYC_TIER_1" | "KYC_TIER_2" | "KYC_TIER_3";

interface KycStatus {
  kycTier: KycTier;
  userId: string;
}

const TIER_INFO: Record<
  KycTier,
  { label: string; limit: string; docs: string[]; color: string }
> = {
  KYC_TIER_0: {
    label: "Unverified",
    limit: "R500/day",
    docs: [],
    color: "text-gray-500",
  },
  KYC_TIER_1: {
    label: "Basic Verified",
    limit: "R5 000/day · R25 000/month",
    docs: ["South African ID number", "Selfie photo"],
    color: "text-blue-600",
  },
  KYC_TIER_2: {
    label: "FICA Verified",
    limit: "R25 000/day · R100 000/month",
    docs: ["SA ID document (photo)", "Proof of address (≤3 months)"],
    color: "text-ahava-600",
  },
  KYC_TIER_3: {
    label: "Full Compliance",
    limit: "R100 000/day · Unlimited monthly",
    docs: ["SA ID document", "Proof of address", "Source of funds declaration"],
    color: "text-yellow-600",
  },
};

const DOCUMENT_TYPES = [
  { value: "SA_ID", label: "SA ID Document / Smart Card" },
  { value: "PASSPORT", label: "Passport" },
  {
    value: "PROOF_OF_ADDRESS",
    label: "Proof of Address (utility bill, bank statement)",
  },
  { value: "SOURCE_OF_FUNDS", label: "Source of Funds Declaration" },
];

export default function KycUpgradePage() {
  const router = useRouter();
  const [kycStatus, setKycStatus] = useState<KycStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState("SA_ID");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    const userId = localStorage.getItem("userId");
    if (!token || !userId) {
      router.replace("/auth/login");
      return;
    }

    apiClient.setTokens(token, localStorage.getItem("refreshToken") || "");
    apiClient
      .getKycStatus(userId)
      .then((res) => {
        if (res.success && res.data) {
          setKycStatus(res.data as KycStatus);
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Please select a document to upload");
      return;
    }

    setUploading(true);
    setError("");
    try {
      const res = await apiClient.uploadKycDocument(file, docType);
      if (res.success) {
        setSuccess(true);
      } else {
        setError(res.error?.message || "Upload failed");
      }
    } catch {
      setError("Upload failed — please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const currentTier = (kycStatus?.kycTier ?? "KYC_TIER_0") as KycTier;
  const currentInfo = TIER_INFO[currentTier];
  const nextTier = (
    currentTier === "KYC_TIER_0"
      ? "KYC_TIER_1"
      : currentTier === "KYC_TIER_1"
        ? "KYC_TIER_2"
        : currentTier === "KYC_TIER_2"
          ? "KYC_TIER_3"
          : null
  ) as KycTier | null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="page-header">
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
        <h1 className="font-bold text-gray-900">Identity Verification</h1>
      </div>

      <div className="max-w-sm mx-auto px-4 py-6 space-y-5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card h-20 animate-pulse bg-gray-100" />
            ))}
          </div>
        ) : success ? (
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
            <h2 className="text-xl font-bold text-gray-900">
              Document uploaded
            </h2>
            <p className="text-gray-500 text-sm">
              We'll review your document within 24–48 hours and notify you when
              your tier is upgraded.
            </p>
            <button
              onClick={() => router.replace("/dashboard")}
              className="btn-primary"
            >
              Back to dashboard
            </button>
          </div>
        ) : (
          <>
            {/* Current tier */}
            <div className="card">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">
                Current tier
              </p>
              <p className={`text-lg font-bold ${currentInfo.color}`}>
                {currentInfo.label}
              </p>
              <p className="text-sm text-gray-600 mt-0.5">
                {currentInfo.limit}
              </p>
            </div>

            {/* Tier ladder */}
            <div className="card space-y-3">
              <h3 className="font-bold text-gray-900 text-sm">
                Verification tiers
              </h3>
              {(
                Object.entries(TIER_INFO) as [
                  KycTier,
                  (typeof TIER_INFO)[KycTier],
                ][]
              ).map(([tier, info]) => {
                const isCurrent = tier === currentTier;
                const isAchieved =
                  Object.keys(TIER_INFO).indexOf(tier) <=
                  Object.keys(TIER_INFO).indexOf(currentTier);
                return (
                  <div
                    key={tier}
                    className={`flex gap-3 p-3 rounded-xl border ${
                      isCurrent
                        ? "border-ahava-300 bg-ahava-50"
                        : isAchieved
                          ? "border-green-200 bg-green-50"
                          : "border-gray-100 bg-gray-50"
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5 ${
                        isAchieved
                          ? "bg-green-500 text-white"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {isAchieved ? "✓" : tier.replace("KYC_TIER_", "")}
                    </div>
                    <div>
                      <p className={`text-sm font-semibold ${info.color}`}>
                        {info.label}
                      </p>
                      <p className="text-xs text-gray-500">{info.limit}</p>
                      {info.docs.length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {info.docs.map((doc) => (
                            <li key={doc} className="text-xs text-gray-400">
                              • {doc}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Upload form */}
            {nextTier ? (
              <div className="card">
                <h3 className="font-bold text-gray-900 mb-1">
                  Upgrade to {TIER_INFO[nextTier].label}
                </h3>
                <p className="text-xs text-gray-500 mb-4">
                  Upload one of the required documents below. Accepted formats:
                  PDF, JPG, PNG (max 10MB).
                </p>

                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                    {error}
                  </div>
                )}

                <form onSubmit={handleUpload} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Document type
                    </label>
                    <select
                      value={docType}
                      onChange={(e) => setDocType(e.target.value)}
                      className="input-field"
                    >
                      {DOCUMENT_TYPES.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Upload document
                    </label>
                    <div
                      className={`border-2 border-dashed rounded-xl p-4 text-center transition
                      ${file ? "border-ahava-400 bg-ahava-50" : "border-gray-300 hover:border-ahava-300"}`}
                    >
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="hidden"
                        id="doc-upload"
                      />
                      <label htmlFor="doc-upload" className="cursor-pointer">
                        {file ? (
                          <div>
                            <p className="text-ahava-700 font-medium text-sm">
                              {file.name}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        ) : (
                          <div>
                            <p className="text-3xl mb-1">📄</p>
                            <p className="text-sm text-gray-600">
                              Tap to select file
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              PDF, JPG or PNG — max 10 MB
                            </p>
                          </div>
                        )}
                      </label>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
                    🔒 Your document is encrypted and stored securely. It is
                    used only for FICA compliance as required by South African
                    law and will never be shared with third parties without
                    consent.
                  </p>

                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={uploading || !file}
                  >
                    {uploading ? "Uploading…" : "Submit document"}
                  </button>
                </form>
              </div>
            ) : (
              <div className="card text-center py-4">
                <p className="text-2xl mb-2">🎉</p>
                <p className="font-bold text-gray-900">Fully verified!</p>
                <p className="text-sm text-gray-500 mt-1">
                  You have the highest KYC tier — no further action required.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
