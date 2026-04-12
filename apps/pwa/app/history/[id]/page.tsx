"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, ErrorState, LoadingState, SessionGuard } from "../../components";
import { ApiError, getSession, getTransaction, toRand, type Transaction } from "../../../lib/api-client";

export default function TransactionDetailPage() {
  const params = useParams<{ id: string }>();
  const [item, setItem] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      const session = getSession();
      if (!session?.walletId) {
        setError("Wallet not in session. Open dashboard first.");
        setLoading(false);
        return;
      }

      try {
        const data = await getTransaction(session.walletId, params.id);
        setItem(data.transaction);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Unable to load transaction detail");
        }
      } finally {
        setLoading(false);
      }
    }

    if (params.id) {
      void load();
    }
  }, [params.id]);

  return (
    <SessionGuard>
      <AppShell title="Transaction Detail">
        {loading && <LoadingState label="Loading transaction detail..." />}
        {!loading && error && <ErrorState label={error} />}

        {!loading && item && (
          <section className="card">
            <h3 style={{ marginTop: 0 }}>{item.transactionType}</h3>
            <p className="amount">{toRand(item.amount)}</p>
            <p className="muted">Status: {item.status}</p>
            <p className="muted">Created: {new Date(item.createdAt).toLocaleString()}</p>
            <p className="muted">Reference: {item.description || "N/A"}</p>
            <p className="muted">Transaction ID: {item.id}</p>
            <Link href="/history"><button className="ghost">Back to History</button></Link>
          </section>
        )}
      </AppShell>
    </SessionGuard>
  );
}
