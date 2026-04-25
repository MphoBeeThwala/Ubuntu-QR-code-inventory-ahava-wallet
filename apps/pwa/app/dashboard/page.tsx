"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";

interface Transaction {
  id: string;
  type: "DEBIT" | "CREDIT";
  amountCents: number;
  description: string;
  createdAt: string;
  status: string;
}

interface WalletBalance {
  balanceCents: number;
  pendingCents: number;
  walletNumber: string;
  kycTier: string;
}

function fmtZAR(cents: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
  });
}

const updateKycTier = async () => {
  const userRes = await apiClient.getUserDetails();
  if (userRes.success && userRes.data) {
    localStorage.setItem("kycTier", userRes.data.kycTier);
    setKycTier(userRes.data.kycTier);
  }
};

export default function DashboardPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceVisible, setBalanceVisible] = useState(true);

  const loadData = useCallback(
    async (wId: string) => {
      try {
        const [balRes, txRes] = await Promise.all([
          apiClient.getBalance(wId),
          apiClient.getTransactionHistory(wId, 5, 0),
        ]);
        if (balRes.success && balRes.data)
          setBalance({
            ...(balRes.data as WalletBalance),
            walletNumber: localStorage.getItem("walletNumber") || "",
            kycTier: localStorage.getItem("kycTier") || "",
          });
        if (txRes.success && txRes.data)
          setTransactions(
            (txRes.data as { transactions: Transaction[] }).transactions ?? [],
          );
      } catch {
        router.replace("/auth/login");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    const wId = localStorage.getItem("walletId");
    if (!token) {
      router.replace("/auth/login");
      return;
    }
    apiClient.setTokens(token, localStorage.getItem("refreshToken") || "");
    if (!wId) {
      // No wallet yet — show dashboard shell without balance
      setBalance({
        balanceCents: 0,
        pendingCents: 0,
        walletNumber: localStorage.getItem("walletNumber") || "",
        kycTier: localStorage.getItem("kycTier") || "",
      });
      setLoading(false);
      return;
    }
    loadData(wId);
  }, [loadData, router]);

  useEffect(() => {
    updateKycTier();
  }, []);

  const handleLogout = () => {
    apiClient.logout();
    localStorage.clear();
    router.replace("/");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-ahava-700">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-white border-t-transparent" />
      </div>
    );
  }

  const kycTierColor: Record<string, string> = {
    TIER_0: "bg-gray-100 text-gray-600",
    TIER_1: "bg-blue-100 text-blue-700",
    TIER_2: "bg-ahava-100 text-ahava-700",
    MERCHANT: "bg-yellow-100 text-yellow-800",
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-gradient-to-r from-ahava-700 to-ahava-600 text-white px-5 pt-10 pb-20">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-ahava-200 text-sm">Ahava Wallet</p>
            {balance?.walletNumber && (
              <p className="text-xs text-ahava-300 mt-0.5">
                {balance.walletNumber}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {balance?.kycTier && (
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${kycTierColor[balance.kycTier] ?? "bg-white/20 text-white"}`}
              >
                {balance.kycTier === "MERCHANT"
                  ? "Merchant"
                  : balance.kycTier.replace("TIER_", "Tier ")}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-ahava-200 hover:text-white text-sm"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Balance card — floating over header */}
      <div className="px-4 -mt-14">
        <div className="card shadow-lg">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                Available
              </p>
              <p className="text-3xl font-bold text-gray-900 mt-1">
                {balanceVisible
                  ? fmtZAR(balance?.balanceCents ?? 0)
                  : "R •••••"}
              </p>
              {(balance?.pendingCents ?? 0) > 0 && (
                <p className="text-xs text-amber-600 mt-0.5">
                  {fmtZAR(balance!.pendingCents)} pending
                </p>
              )}
            </div>
            <button
              onClick={() => setBalanceVisible((v) => !v)}
              className="text-gray-400 hover:text-gray-600 transition p-1"
              aria-label={balanceVisible ? "Hide balance" : "Show balance"}
            >
              {balanceVisible ? (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7
                       -1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              ) : (
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7
                       a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243
                       M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29
                       M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7
                       a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              )}
            </button>
          </div>

          {/* KYC upgrade nudge */}
          {balance?.kycTier === "TIER_0" && (
            <Link
              href="/kyc/upgrade"
              className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700"
            >
              <span>⚠️</span>
              <span>Verify your identity to unlock higher limits</span>
              <span className="ml-auto font-semibold">Upgrade →</span>
            </Link>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-4 mt-5">
        <div className="grid grid-cols-4 gap-3">
          {[
            {
              href: "/wallet/send",
              icon: "↑",
              label: "Send",
              bg: "bg-ahava-600",
            },
            {
              href: "/wallet/qr",
              icon: "⬛",
              label: "My QR",
              bg: "bg-blue-500",
            },
            {
              href: "/wallet/scan",
              icon: "⬛",
              label: "Scan QR",
              bg: "bg-purple-500",
            },
            {
              href: "/wallet/history",
              icon: "≡",
              label: "History",
              bg: "bg-gray-500",
            },
          ].map(({ href, icon, label, bg }) => (
            <Link key={href} href={href}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`${bg} text-white w-12 h-12 rounded-2xl flex items-center justify-center text-xl shadow-sm`}
                >
                  {icon}
                </div>
                <span className="text-xs text-gray-600 font-medium">
                  {label}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="px-4 mt-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-gray-900">Recent transactions</h3>
          <Link
            href="/wallet/history"
            className="text-sm text-ahava-600 font-medium"
          >
            See all
          </Link>
        </div>

        <div className="card divide-y divide-gray-50">
          {transactions.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">
              No transactions yet
            </p>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
                  ${tx.type === "CREDIT" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}
                >
                  {tx.type === "CREDIT" ? "+" : "−"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {tx.description || "Transaction"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {timeAgo(tx.createdAt)}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold ${tx.type === "CREDIT" ? "text-green-600" : "text-gray-900"}`}
                >
                  {tx.type === "CREDIT" ? "+" : "−"}
                  {fmtZAR(tx.amountCents)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex">
        {[
          { href: "/dashboard", icon: "⌂", label: "Home", active: true },
          { href: "/wallet/send", icon: "↑", label: "Send", active: false },
          {
            href: "/wallet/history",
            icon: "≡",
            label: "History",
            active: false,
          },
          { href: "/kyc/upgrade", icon: "◈", label: "KYC", active: false },
        ].map(({ href, icon, label, active }) => (
          <Link
            key={href}
            href={href}
            className={`flex-1 flex flex-col items-center py-3 gap-0.5
            ${active ? "text-ahava-600" : "text-gray-400"}`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span className="text-xs">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
