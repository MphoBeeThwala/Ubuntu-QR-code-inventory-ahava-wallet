"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, SessionGuard } from "../../components";
import { getPaymentResult, toRand, type Transaction } from "../../../lib/api-client";

type SuccessPayload = {
  status: "success";
  debit: Transaction;
  fee: number;
  receiverName: string;
};

export default function TransferSuccessPage() {
  const [result, setResult] = useState<SuccessPayload | null>(null);

  useEffect(() => {
    setResult(getPaymentResult<SuccessPayload>());
  }, []);

  return (
    <SessionGuard>
      <AppShell title="Transfer Success">
        <section className="card">
          <span className="pill">Success</span>
          <h3>Transfer completed</h3>
          {result ? (
            <>
              <p className="muted">Receiver: {result.receiverName}</p>
              <p className="amount">{toRand(result.debit.amount)}</p>
              <p className="muted">Txn: {result.debit.id}</p>
            </>
          ) : (
            <p className="muted">Transfer succeeded. Return to dashboard for details.</p>
          )}
          <div className="grid-2">
            <Link href="/dashboard"><button>Back Home</button></Link>
            <Link href="/history"><button className="button-alt">View History</button></Link>
          </div>
        </section>
      </AppShell>
    </SessionGuard>
  );
}

