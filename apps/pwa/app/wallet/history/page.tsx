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
  status: "COMPLETED" | "PENDING" | "FAILED" | "REVERSED";
  channel: string;
  balanceAfter: number;
}

function fmtZAR(cents: number): string {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "text-green-600",
  PENDING: "text-amber-600",
  FAILED: "text-red-600",
  REVERSED: "text-gray-400",
};

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<"ALL" | "DEBIT" | "CREDIT">("ALL");

  const load = useCallback(
    async (off: number, replace: boolean) => {
      const walletId = localStorage.getItem("walletId");
      if (!walletId) {
        router.replace("/auth/login");
        return;
      }

      try {
        const res = await apiClient.getTransactionHistory(
          walletId,
          PAGE_SIZE,
          off,
        );
        if (res.success && res.data) {
          const txns =
            (res.data as { transactions: Transaction[] }).transactions ?? [];
          setTransactions((prev) => (replace ? txns : [...prev, ...txns]));
          setHasMore(txns.length === PAGE_SIZE);
          setOffset(off + txns.length);
        }
      } catch {
        router.replace("/auth/login");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [router],
  );

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (!token) {
      router.replace("/auth/login");
      return;
    }
    apiClient.setTokens(token, localStorage.getItem("refreshToken") || "");
    load(0, true);
  }, [load, router]);

  const handleLoadMore = () => {
    setLoadingMore(true);
    load(offset, false);
  };

  const filtered =
    filter === "ALL"
      ? transactions
      : transactions.filter((t) => t.type === filter);

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
        <h1 className="font-bold text-gray-900">Transaction History</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex bg-white border-b border-gray-100 px-4 gap-4">
        {(["ALL", "CREDIT", "DEBIT"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`py-3 text-sm font-medium border-b-2 transition-colors ${
              filter === f
                ? "border-ahava-600 text-ahava-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {f === "ALL" ? "All" : f === "CREDIT" ? "Money In" : "Money Out"}
          </button>
        ))}
      </div>

      <div className="max-w-lg mx-auto px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card animate-pulse flex gap-3">
                <div className="w-10 h-10 bg-gray-200 rounded-full" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 bg-gray-200 rounded w-3/4" />
                  <div className="h-2 bg-gray-200 rounded w-1/2" />
                </div>
                <div className="h-4 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-500 font-medium">No transactions yet</p>
            <p className="text-gray-400 text-sm mt-1">
              Your payment history will appear here
            </p>
            <Link
              href="/wallet/send"
              className="btn-primary mt-6 inline-block w-auto px-8"
            >
              Send money
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((tx) => (
              <div key={tx.id} className="card flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                  ${tx.type === "CREDIT" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}
                >
                  {tx.type === "CREDIT" ? "↓" : "↑"}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {tx.description ||
                      (tx.type === "CREDIT" ? "Received" : "Sent")}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-400">
                      {fmtDate(tx.createdAt)}
                    </p>
                    {tx.channel && (
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                        {tx.channel}
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <p
                    className={`text-sm font-bold ${tx.type === "CREDIT" ? "text-green-600" : "text-gray-900"}`}
                  >
                    {tx.type === "CREDIT" ? "+" : "−"}
                    {fmtZAR(tx.amountCents)}
                  </p>
                  <p
                    className={`text-xs ${STATUS_COLORS[tx.status] ?? "text-gray-400"}`}
                  >
                    {tx.status.toLowerCase()}
                  </p>
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full py-3 text-sm text-ahava-600 font-medium border border-ahava-200 rounded-xl hover:bg-ahava-50 transition disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
