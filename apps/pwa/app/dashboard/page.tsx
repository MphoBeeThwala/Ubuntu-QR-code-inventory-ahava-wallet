"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, EmptyState, ErrorState, LoadingState, SessionGuard } from "../components";
import { ApiError, getSession, getUserWalletBalance, listTransactions, saveSession, toRand, type Transaction, type WalletBalance } from "../../lib/api-client";

export default function DashboardPage() {
  const [walletId, setWalletId] = useState<string>("");
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const session = getSession();
      if (!session) return;

      try {
        const wallet = await getUserWalletBalance(session.userId);
        setWalletId(wallet.walletId);
        setBalance(wallet.balance);
        saveSession({ ...session, walletId: wallet.walletId });

        const history = await listTransactions(wallet.walletId);
        setTransactions(history.transactions.slice(0, 5));
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not load wallet dashboard");
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <SessionGuard>
      <AppShell title="Wallet Dashboard">
        {loading && <LoadingState label="Loading wallet..." />}
        {!loading && error && <ErrorState label={error} />}

        {!loading && balance && (
          <section className="card balance">
            <p className="muted" style={{ color: "#deece6" }}>Available</p>
            <p className="amount">{toRand(balance.available)}</p>
            <p className="muted" style={{ color: "#deece6" }}>Wallet ID: {walletId}</p>
          </section>
        )}

        <section className="grid-2">
          <Link href="/send"><button>Send Money</button></Link>
          <Link href="/history"><button className="button-alt">View History</button></Link>
        </section>

        <section className="card">
          <div className="row">
            <h3 style={{ margin: 0 }}>Recent Transactions</h3>
            <Link href="/history">See all</Link>
          </div>
          {transactions.length === 0 && <EmptyState label="No transactions yet" />}
          {transactions.length > 0 && (
            <ul className="list">
              {transactions.map((txn) => (
                <li key={txn.id}>
                  <div className="row">
                    <strong>{txn.transactionType}</strong>
                    <span>{toRand(txn.amount)}</span>
                  </div>
                  <p className="muted">{txn.status} • {new Date(txn.createdAt).toLocaleString()}</p>
                  <Link href={`/history/${txn.id}`}>Open</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </AppShell>
    </SessionGuard>
  );
}

