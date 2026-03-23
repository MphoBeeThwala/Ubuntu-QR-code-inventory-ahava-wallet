"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios, { AxiosInstance } from "axios";
import Sidebar from "../components/Sidebar";

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  status: string;
  customerPhone?: string;
  walletId?: string;
  createdAt: string;
  description?: string;
}

function fmtZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-700",
  PENDING: "bg-amber-100 text-amber-700",
  FAILED: "bg-red-100 text-red-600",
  REVERSED: "bg-gray-100 text-gray-500",
};

const TYPE_LABELS: Record<string, string> = {
  CASH_IN: "Cash In",
  CASH_OUT: "Cash Out",
  TRANSFER: "Transfer",
  PAYMENT: "Payment",
  DEBIT: "Debit",
  CREDIT: "Credit",
};

export default function TransactionsPage() {
  const router = useRouter();
  const [api, setApi] = useState<AxiosInstance | null>(null);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 25;

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

  const fetchTransactions = useCallback(
    async (pageNum: number, filter: string) => {
      if (!api) return;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE + 1),
          offset: String((pageNum - 1) * PAGE_SIZE),
        });
        if (filter !== "ALL") params.set("type", filter);

        const res = await api.get(`/agents/transactions?${params}`);
        const rows: Transaction[] = res.data?.data?.transactions ?? [];
        setHasMore(rows.length > PAGE_SIZE);
        setTransactions(rows.slice(0, PAGE_SIZE));
      } catch {
        setError("Failed to load transactions");
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  useEffect(() => {
    fetchTransactions(page, typeFilter);
  }, [fetchTransactions, page, typeFilter]);

  function handleFilterChange(f: string) {
    setTypeFilter(f);
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex h-screen">
      <Sidebar />

      <main className="flex-1 overflow-auto px-8 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Transactions</h2>
            <p className="text-gray-500 text-sm mt-1">
              All cash-in and cash-out operations
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/cash-in")}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
            >
              ⬇ Cash In
            </button>
            <button
              onClick={() => router.push("/cash-out")}
              className="bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium px-4 py-2 rounded-xl transition"
            >
              ⬆ Cash Out
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-white rounded-xl border border-gray-100 p-1 mb-5 w-fit shadow-sm">
          {["ALL", "CASH_IN", "CASH_OUT"].map((f) => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
                typeFilter === f
                  ? "bg-gray-900 text-white"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {f === "ALL" ? "All" : f === "CASH_IN" ? "Cash In" : "Cash Out"}
            </button>
          ))}
        </div>

        {/* Table card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          {loading ? (
            <div className="p-8 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 bg-gray-100 rounded-lg animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-red-500 text-sm">{error}</p>
              <button
                onClick={() => fetchTransactions(page, typeFilter)}
                className="mt-3 text-sm text-blue-600 hover:underline"
              >
                Retry
              </button>
            </div>
          ) : transactions.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-4xl mb-3">↕</p>
              <p className="text-gray-500 text-sm">No transactions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Customer</th>
                    <th className="px-5 py-3 font-medium">Type</th>
                    <th className="px-5 py-3 font-medium">Amount</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {transactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                        {fmtDate(tx.createdAt)}
                      </td>
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {tx.customerPhone ?? tx.walletId?.slice(0, 8) ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium ${
                            tx.type === "CASH_IN" || tx.type === "CREDIT"
                              ? "text-green-700"
                              : "text-orange-700"
                          }`}
                        >
                          {tx.type === "CASH_IN" || tx.type === "CREDIT"
                            ? "⬇"
                            : "⬆"}
                          {TYPE_LABELS[tx.type] ?? tx.type}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-semibold text-gray-900">
                        {fmtZAR(tx.amountCents)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[tx.status] ?? "bg-gray-100 text-gray-500"}`}
                        >
                          {tx.status.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-400 max-w-xs truncate">
                        {tx.description ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {!loading && !error && transactions.length > 0 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Page {page} · {transactions.length} rows
              </p>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition"
                >
                  ← Prev
                </button>
                <button
                  disabled={!hasMore}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
