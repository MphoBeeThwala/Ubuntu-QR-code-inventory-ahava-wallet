"use client";

import React, { useCallback, useEffect, useState } from "react";
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

export default function DashboardPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [_kycTier, _setKycTier] = useState<string>("");

  const updateKycTier = async () => {
    const userRes = await apiClient.getUserDetails();
    if (userRes.success && userRes.data) {
      localStorage.setItem("kycTier", userRes.data.kycTier);
      _setKycTier(userRes.data.kycTier);
    }
  };

  const loadData = useCallback(
    async (walletId: string) => {
      try {
        const [balRes, txRes] = await Promise.all([
          apiClient.getBalance(walletId),
          apiClient.getTransactionHistory(walletId, 5, 0),
        ]);

        if (balRes.success && balRes.data) {
          setBalance({
            ...(balRes.data as WalletBalance),
            walletNumber: localStorage.getItem("walletNumber") || "",
            kycTier: localStorage.getItem("kycTier") || "",
          });
        }

        if (txRes.success && txRes.data) {
          setTransactions(
            (txRes.data as { transactions: Transaction[] }).transactions ?? [],
          );
        }
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
    const walletId = localStorage.getItem("walletId");

    if (!token) {
      router.replace("/auth/login");
      return;
    }

    apiClient.setTokens(token, localStorage.getItem("refreshToken") || "");

    if (!walletId) {
      setBalance({
        balanceCents: 0,
        pendingCents: 0,
        walletNumber: localStorage.getItem("walletNumber") || "",
        kycTier: localStorage.getItem("kycTier") || "",
      });
      setLoading(false);
      return;
    }

    loadData(walletId);
  }, [loadData, router]);

  useEffect(() => {
    updateKycTier();
  }, []);

  const handleLogout = () => {
    apiClient.logout();
    localStorage.clear();
    router.replace("/");
  };

  const isMerchant = balance?.kycTier === "MERCHANT";

  const quickActions = isMerchant
    ? [
        {
          href: "/merchant/receive",
          icon: "\u2301",
          label: "Receive",
          bg: "bg-emerald-600",
        },
        {
          href: "/wallet/scan",
          icon: "\u25f3",
          label: "Scan QR",
          bg: "bg-purple-500",
        },
        {
          href: "/wallet/history",
          icon: "\u2261",
          label: "History",
          bg: "bg-slate-600",
        },
        {
          href: "/wallet/send",
          icon: "\u2191",
          label: "Send",
          bg: "bg-blue-500",
        },
      ]
    : [
        {
          href: "/wallet/send",
          icon: "\u2191",
          label: "Send",
          bg: "bg-ahava-600",
        },
        {
          href: "/wallet/qr",
          icon: "\u25f3",
          label: "My QR",
          bg: "bg-blue-500",
        },
        {
          href: "/wallet/scan",
          icon: "\u25f3",
          label: "Scan QR",
          bg: "bg-purple-500",
        },
        {
          href: "/wallet/history",
          icon: "\u2261",
          label: "History",
          bg: "bg-gray-500",
        },
      ];

  const bottomNavItems = isMerchant
    ? [
        { href: "/dashboard", icon: "\u2302", label: "Home", active: true },
        {
          href: "/merchant/receive",
          icon: "\u2301",
          label: "Receive",
          active: false,
        },
        {
          href: "/wallet/history",
          icon: "\u2261",
          label: "History",
          active: false,
        },
        { href: "/wallet/scan", icon: "\u25f3", label: "Scan", active: false },
      ]
    : [
        { href: "/dashboard", icon: "\u2302", label: "Home", active: true },
        { href: "/wallet/send", icon: "\u2191", label: "Send", active: false },
        {
          href: "/wallet/history",
          icon: "\u2261",
          label: "History",
          active: false,
        },
        {
          href: "/kyc/upgrade",
          icon: "\u25c8",
          label: "KYC",
          active: false,
        },
      ];

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ahava-700">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white border-t-transparent" />
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
      <header className="bg-gradient-to-r from-ahava-700 to-ahava-600 px-5 pb-20 pt-10 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-ahava-200">Ubuntu Wallet</p>
            {balance?.walletNumber && (
              <p className="mt-0.5 text-xs text-ahava-300">
                {balance.walletNumber}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {balance?.kycTier && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${kycTierColor[balance.kycTier] ?? "bg-white/20 text-white"}`}
              >
                {balance.kycTier === "MERCHANT"
                  ? "Merchant"
                  : balance.kycTier.replace("TIER_", "Tier ")}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-ahava-200 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="px-4 -mt-14">
        <div className="card shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Available
              </p>
              <p className="mt-1 text-3xl font-bold text-gray-900">
                {balanceVisible
                  ? fmtZAR(balance?.balanceCents ?? 0)
                  : "R •••••"}
              </p>
              {(balance?.pendingCents ?? 0) > 0 && (
                <p className="mt-0.5 text-xs text-amber-600">
                  {fmtZAR(balance!.pendingCents)} pending
                </p>
              )}
            </div>

            <button
              onClick={() => setBalanceVisible((value) => !value)}
              className="p-1 text-gray-400 transition hover:text-gray-600"
              aria-label={balanceVisible ? "Hide balance" : "Show balance"}
            >
              {balanceVisible ? (
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
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              ) : (
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
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              )}
            </button>
          </div>

          {balance?.kycTier === "TIER_0" && (
            <Link
              href="/kyc/upgrade"
              className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700"
            >
              <span>!</span>
              <span>Verify your identity to unlock higher limits</span>
              <span className="ml-auto font-semibold">Upgrade {"->"}</span>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-5 px-4">
        <div className="grid grid-cols-4 gap-3">
          {quickActions.map(({ href, icon, label, bg }) => (
            <Link key={href} href={href}>
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`${bg} flex h-12 w-12 items-center justify-center rounded-2xl text-xl text-white shadow-sm`}
                >
                  {icon}
                </div>
                <span className="text-xs font-medium text-gray-600">
                  {label}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {isMerchant && (
        <div className="mt-6 px-4">
          <div className="rounded-[28px] bg-[radial-gradient(circle_at_top_right,#86efac,transparent_35%),linear-gradient(135deg,#052e16_0%,#14532d_48%,#166534_100%)] p-5 text-white shadow-lg">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-200/80">
                  Merchant Mode
                </p>
                <h2 className="mt-2 text-xl font-bold">
                  Accept QR payments in seconds
                </h2>
                <p className="mt-2 max-w-md text-sm text-emerald-50/85">
                  Create an open or fixed-amount QR for goods and services, then
                  let customers pay from the Ubuntu wallet flow.
                </p>
              </div>
              <div className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                Investor demo ready
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/merchant/receive"
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
              >
                Open receive screen
              </Link>
              <Link
                href="/wallet/history"
                className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
              >
                Review incoming payments
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 px-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Recent transactions</h3>
          <Link
            href="/wallet/history"
            className="text-sm font-medium text-ahava-600"
          >
            See all
          </Link>
        </div>

        <div className="card divide-y divide-gray-50">
          {transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">
              No transactions yet
            </p>
          ) : (
            transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    tx.type === "CREDIT"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-600"
                  }`}
                >
                  {tx.type === "CREDIT" ? "+" : "-"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {tx.description || "Transaction"}
                  </p>
                  <p className="text-xs text-gray-400">
                    {timeAgo(tx.createdAt)}
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold ${
                    tx.type === "CREDIT" ? "text-green-600" : "text-gray-900"
                  }`}
                >
                  {tx.type === "CREDIT" ? "+" : "-"}
                  {fmtZAR(tx.amountCents)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <nav className="fixed bottom-0 left-0 right-0 flex border-t border-gray-200 bg-white">
        {bottomNavItems.map(({ href, icon, label, active }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-3 ${
              active ? "text-ahava-600" : "text-gray-400"
            }`}
          >
            <span className="text-lg leading-none">{icon}</span>
            <span className="text-xs">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
