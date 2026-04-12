"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, EmptyState, ErrorState, LoadingState, SessionGuard } from "../components";
import { ApiError, getSession, listTransactions, toRand, type Transaction } from "../../lib/api-client";

export default function HistoryPage() {
  const [items, setItems] = useState<Transaction[]>([]);
  const [direction, setDirection] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const session = getSession();
      if (!session?.walletId) {
        setError("Wallet is not loaded yet. Open dashboard first.");
        setLoading(false);
        return;
      }

      try {
        const res = await listTransactions(session.walletId, direction);
        setItems(res.transactions);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not load transaction history");
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [direction]);

  return (
    <SessionGuard>
      <AppShell title="Transaction History">
        <section className="card">
          <label>
            Filter
            <select value={direction} onChange={(event) => setDirection(event.target.value)}>
              <option value="all">All</option>
              <option value="sent">Sent</option>
              <option value="received">Received</option>
            </select>
          </label>
        </section>

        {loading && <LoadingState label="Loading transactions..." />}
        {!loading && error && <ErrorState label={error} />}
        {!loading && !error && items.length === 0 && <EmptyState label="No transactions for this filter" />}

        {!loading && !error && items.length > 0 && (
          <ul className="list">
            {items.map((txn) => (
              <li key={txn.id}>
                <div className="row">
                  <strong>{txn.transactionType}</strong>
                  <span>{toRand(txn.amount)}</span>
                </div>
                <p className="muted">{txn.status} • {new Date(txn.createdAt).toLocaleString()}</p>
                <Link href={`/history/${txn.id}`}>Transaction detail</Link>
              </li>
            ))}
          </ul>
        )}
      </AppShell>
    </SessionGuard>
  );
}

