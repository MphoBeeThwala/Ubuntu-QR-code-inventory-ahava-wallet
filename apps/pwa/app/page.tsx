"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { apiClient } from "../lib/api-client";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem("accessToken");
        const walletId = localStorage.getItem("walletId"); // Assuming we store this on login
        if (token && walletId) {
          apiClient.setTokens(
            token,
            localStorage.getItem("refreshToken") || "",
          );
          const response = await apiClient.getBalance(walletId);
          if (response.success && response.data) {
            setBalance(response.data.balanceCents / 100);
            setIsLoggedIn(true);
          }
        } else {
          setIsLoggedIn(false);
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        setIsLoggedIn(false);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="w-full max-w-sm p-6 space-y-6">
          <div className="h-16 bg-gray-200 rounded-3xl animate-pulse"></div>
          <div className="h-40 bg-gray-200 rounded-3xl animate-pulse"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-20 bg-gray-200 rounded-3xl animate-pulse"
              ></div>
            ))}
          </div>
          <div className="h-56 bg-gray-200 rounded-3xl animate-pulse mt-8"></div>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-ahava-800 via-ahava-700 to-ahava-900 flex flex-col items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative background elements */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-ahava-500/20 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-ahava-400/20 rounded-full blur-3xl"></div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="z-10 flex flex-col items-center w-full max-w-sm"
        >
          <div className="w-20 h-20 bg-white rounded-3xl shadow-2xl flex items-center justify-center mb-8 transform rotate-3">
            <span className="text-4xl font-bold text-ahava-600 -rotate-3">
              A
            </span>
          </div>

          <h1 className="text-5xl font-bold text-white mb-3 tracking-tight">
            Ubuntu
          </h1>
          <p className="text-ahava-100 mb-12 text-center font-medium text-lg opacity-90">
            South African digital wallet and QR commerce platform
          </p>

          <div className="space-y-4 w-full bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/20">
            <Link href="/auth/login" className="block w-full">
              <button className="w-full bg-white text-ahava-700 font-semibold py-4 rounded-2xl shadow-lg hover:shadow-xl transition-all active:scale-[0.98]">
                Sign In
              </button>
            </Link>
            <Link href="/auth/register" className="block w-full">
              <button className="w-full bg-transparent text-white border border-white/30 font-semibold py-4 rounded-2xl hover:bg-white/10 transition-all active:scale-[0.98]">
                Create Account
              </button>
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleLogout = () => {
    apiClient.logout();
    localStorage.removeItem("walletId");
    setIsLoggedIn(false);
    router.push("/auth/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-20 px-6 py-4 flex justify-between items-center border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-ahava-600 rounded-xl flex items-center justify-center text-white font-bold text-sm">
            A
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900">
            Ubuntu
          </h1>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm font-semibold text-gray-500 hover:text-ahava-600 transition-colors"
        >
          Sign Out
        </button>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto p-6">
        {/* Balance Card */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-gradient-to-br from-ahava-600 to-ahava-800 text-white rounded-[2.5rem] p-8 mb-8 shadow-xl shadow-ahava-200 relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-16 -mt-16"></div>
          <p className="text-ahava-100 text-sm font-medium mb-1">
            Available Balance
          </p>
          <h2 className="text-5xl font-bold tracking-tight mb-6">
            R {balance.toFixed(2)}
          </h2>
          <div className="flex gap-3">
            <Link href="/wallet/add" className="flex-1">
              <button className="w-full bg-white/20 backdrop-blur-md hover:bg-white/30 transition-all py-2.5 rounded-2xl text-sm font-semibold">
                + Top Up
              </button>
            </Link>
            <Link href="/wallet/history" className="flex-1">
              <button className="w-full bg-white/10 hover:bg-white/20 transition-all py-2.5 rounded-2xl text-sm font-semibold">
                Details
              </button>
            </Link>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-10">
          {[
            {
              href: "/wallet/send",
              label: "Send",
              icon: "↑",
              color: "bg-blue-50 text-blue-600",
            },
            {
              href: "/wallet/scan",
              label: "Scan QR",
              icon: "⛶",
              color: "bg-purple-50 text-purple-600",
            },
            {
              href: "/wallet/request",
              label: "Request",
              icon: "↓",
              color: "bg-orange-50 text-orange-600",
            },
            {
              href: "/wallet/history",
              label: "History",
              icon: "▤",
              color: "bg-gray-50 text-gray-600",
            },
          ].map((action, i) => (
            <motion.div
              key={action.href}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Link href={action.href}>
                <div className="bg-white p-6 rounded-[2rem] border border-gray-50 shadow-sm hover:shadow-md transition-all active:scale-[0.97] flex flex-col items-center gap-3">
                  <div
                    className={`${action.color} w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold`}
                  >
                    {action.icon}
                  </div>
                  <p className="font-bold text-gray-700 text-sm">
                    {action.label}
                  </p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Recent Transactions */}
        <div className="space-y-4">
          <div className="flex justify-between items-center px-2">
            <h3 className="text-xl font-bold text-gray-900">Activity</h3>
            <Link
              href="/wallet/history"
              className="text-sm font-bold text-ahava-600"
            >
              See All
            </Link>
          </div>
          <div className="bg-white rounded-[2.5rem] shadow-sm border border-gray-50 p-2">
            {/* TODO: Map transactions */}
            <div className="flex items-center justify-center py-12 text-gray-400 flex-col gap-2">
              <div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-xl">
                ∅
              </div>
              <p className="text-sm font-medium">No recent activity</p>
            </div>
          </div>
        </div>
      </main>

      {/* Modern Bottom Tab Bar */}
      <nav className="fixed bottom-6 left-6 right-6 bg-gray-900/90 backdrop-blur-lg rounded-[2rem] p-2 flex items-center justify-around shadow-2xl z-30">
        {[
          { href: "/", label: "Home", icon: "●" },
          { href: "/wallet/scan", label: "Scan", icon: "⛶" },
          { href: "/profile", label: "Profile", icon: "○" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex flex-col items-center p-3 text-white"
          >
            <span className="text-xl">{item.icon}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
