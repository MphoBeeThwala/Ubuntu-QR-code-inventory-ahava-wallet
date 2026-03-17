'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // TODO: Check auth token and fetch balance
    const checkAuth = async () => {
      try {
        // const token = localStorage.getItem('accessToken');
        // if (token) {
        //   const response = await fetch('/api/wallet/balance', {
        //     headers: { Authorization: `Bearer ${token}` }
        //   });
        //   const data = await response.json();
        //   setBalance(data.balanceCents / 100);
        //   setIsLoggedIn(true);
        // }
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-green-700 to-green-900">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-green-200"></div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-700 to-green-900 flex flex-col items-center justify-center p-4">
        <h1 className="text-5xl font-bold text-white mb-4">Ahava</h1>
        <p className="text-green-100 mb-12 text-center">South African Digital Wallet</p>
        
        <div className="space-y-4 w-full max-w-md">
          <Link href="/auth/login">
            <button className="w-full bg-white text-green-700 font-bold py-3 rounded-lg hover:bg-gray-100 transition">
              Login
            </button>
          </Link>
          <Link href="/auth/register">
            <button className="w-full bg-green-600 text-white font-bold py-3 rounded-lg hover:bg-green-500 transition">
              Create Account
            </button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-gradient-to-r from-green-700 to-green-600 text-white p-6">
        <h1 className="text-2xl font-bold">Ahava Wallet</h1>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto p-6">
        {/* Balance Card */}
        <div className="bg-gradient-to-r from-green-700 to-green-600 text-white rounded-lg p-8 mb-6 shadow-lg">
          <p className="text-sm opacity-90">Available Balance</p>
          <h2 className="text-4xl font-bold">R {balance.toFixed(2)}</h2>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <Link href="/wallet/send">
            <button className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition text-center">
              <div className="text-3xl mb-2">💸</div>
              <p className="font-semibold">Send Money</p>
            </button>
          </Link>
          <Link href="/wallet/request">
            <button className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition text-center">
              <div className="text-3xl mb-2">📥</div>
              <p className="font-semibold">Request Money</p>
            </button>
          </Link>
          <Link href="/wallet/scan">
            <button className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition text-center">
              <div className="text-3xl mb-2">📱</div>
              <p className="font-semibold">Scan QR</p>
            </button>
          </Link>
          <Link href="/wallet/history">
            <button className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition text-center">
              <div className="text-3xl mb-2">📋</div>
              <p className="font-semibold">History</p>
            </button>
          </Link>
        </div>

        {/* Recent Transactions */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-bold mb-4">Recent Transactions</h3>
          <div className="space-y-4">
            {/* TODO: Fetch and render transaction list */}
            <p className="text-gray-500 text-center py-8">No transactions yet</p>
          </div>
        </div>
      </main>
    </div>
  );
}
