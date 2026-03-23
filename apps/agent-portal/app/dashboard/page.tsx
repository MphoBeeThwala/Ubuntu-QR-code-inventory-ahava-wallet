"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

interface AgentStats {
  totalCustomers: number;
  activeToday: number;
  totalTransactionsCents: number;
  transactionCount: number;
  pendingKyc: number;
  successRate: number;
}

interface RecentTransaction {
  id: string;
  customerPhone: string;
  type: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

function fmtZAR(cents: number) {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(cents / 100);
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function AgentDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentEmail, setAgentEmail] = useState("");

  useEffect(() => {
    const token = localStorage.getItem("agentToken");
    if (!token) {
      router.replace("/login");
      return;
    }
    setAgentEmail(localStorage.getItem("agentEmail") || "Agent");

    const api = axios.create({
      baseURL: process.env.NEXT_PUBLIC_API_URL,
      headers: { Authorization: `Bearer ${token}` },
    });

    Promise.all([
      api.get("/agents/stats"),
      api.get("/agents/transactions?limit=10"),
    ])
      .then(([statsRes, txRes]) => {
        setStats(statsRes.data?.data ?? null);
        setTransactions(txRes.data?.data?.transactions ?? []);
      })
      .catch(() => {
        // Use placeholder data if API not yet available
        setStats({
          totalCustomers: 0,
          activeToday: 0,
          totalTransactionsCents: 0,
          transactionCount: 0,
          pendingKyc: 0,
          successRate: 100,
        });
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem("agentToken");
    localStorage.removeItem("agentEmail");
    router.replace("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar + main layout */}
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside className="w-60 bg-navy-900 text-white flex flex-col">
          <div className="px-6 py-5 border-b border-white/10">
            <h1 className="text-xl font-bold">Ahava</h1>
            <p className="text-xs text-gray-400 mt-0.5">Agent Portal</p>
          </div>
          <nav className="flex-1 px-3 py-4 space-y-1">
            {[
              { label: "Dashboard", icon: "⌂", active: true },
              { label: "Customers", icon: "👥", active: false },
              { label: "Transactions", icon: "↕", active: false },
              { label: "KYC Queue", icon: "📋", active: false },
              { label: "Reports", icon: "📊", active: false },
            ].map((item) => (
              <button
                key={item.label}
                className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition
                  ${item.active ? "bg-white/10 text-white font-medium" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}
              >
                <span>{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="px-4 py-4 border-t border-white/10">
            <p className="text-xs text-gray-400 truncate mb-2">{agentEmail}</p>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-red-400 transition"
            >
              Sign out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <div className="px-8 py-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
                <p className="text-gray-500 text-sm">
                  {new Date().toLocaleDateString("en-ZA", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="card h-24 animate-pulse bg-gray-100"
                  />
                ))}
              </div>
            ) : (
              <>
                {/* Stats grid */}
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                  {[
                    {
                      label: "Total Customers",
                      value: stats?.totalCustomers.toLocaleString() ?? "—",
                      icon: "👥",
                      color: "text-blue-600",
                    },
                    {
                      label: "Active Today",
                      value: stats?.activeToday.toLocaleString() ?? "—",
                      icon: "⚡",
                      color: "text-green-600",
                    },
                    {
                      label: "Volume Today",
                      value: fmtZAR(stats?.totalTransactionsCents ?? 0),
                      icon: "💰",
                      color: "text-navy-800",
                    },
                    {
                      label: "Transactions",
                      value: stats?.transactionCount.toLocaleString() ?? "—",
                      icon: "↕",
                      color: "text-purple-600",
                    },
                    {
                      label: "Pending KYC",
                      value: stats?.pendingKyc.toLocaleString() ?? "—",
                      icon: "📋",
                      color: "text-amber-600",
                    },
                    {
                      label: "Success Rate",
                      value: `${stats?.successRate ?? 0}%`,
                      icon: "✓",
                      color: "text-green-600",
                    },
                  ].map((stat) => (
                    <div key={stat.label} className="stat-card">
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">
                          {stat.label}
                        </span>
                        <span className="text-xl">{stat.icon}</span>
                      </div>
                      <p className={`text-2xl font-bold ${stat.color} mt-1`}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Recent Transactions */}
                <div className="card">
                  <h3 className="font-bold text-gray-900 mb-4">
                    Recent Transactions
                  </h3>
                  {transactions.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-8">
                      No transactions yet
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                            <th className="pb-2 font-medium">Customer</th>
                            <th className="pb-2 font-medium">Type</th>
                            <th className="pb-2 font-medium">Amount</th>
                            <th className="pb-2 font-medium">Status</th>
                            <th className="pb-2 font-medium">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {transactions.map((tx) => (
                            <tr key={tx.id}>
                              <td className="py-2.5 font-medium text-gray-900">
                                {tx.customerPhone}
                              </td>
                              <td className="py-2.5 text-gray-500">
                                {tx.type}
                              </td>
                              <td className="py-2.5 font-medium">
                                {fmtZAR(tx.amountCents)}
                              </td>
                              <td className="py-2.5">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                    tx.status === "COMPLETED"
                                      ? "bg-green-100 text-green-700"
                                      : tx.status === "PENDING"
                                        ? "bg-amber-100 text-amber-700"
                                        : "bg-red-100 text-red-600"
                                  }`}
                                >
                                  {tx.status.toLowerCase()}
                                </span>
                              </td>
                              <td className="py-2.5 text-gray-400">
                                {timeAgo(tx.createdAt)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
