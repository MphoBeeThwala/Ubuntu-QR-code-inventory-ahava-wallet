"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell, ErrorState, LoadingState, SessionGuard } from "../../components";
import { ApiError, clearPaymentDraft, getPaymentDraft, getSession, savePaymentResult, sendPayment, toRand } from "../../../lib/api-client";

type Draft = {
  walletNumber: string;
  receiverWalletId: string;
  receiverName: string;
  amountCents: number;
  description?: string;
};

export default function ConfirmPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const existing = getPaymentDraft<Draft>();
    if (!existing) {
      router.replace("/send");
      return;
    }
    setDraft(existing);
  }, [router]);

  async function onConfirm() {
    if (!draft) return;
    const session = getSession();
    if (!session?.walletId) {
      setError("Wallet session missing. Go back to dashboard first.");
      return;
    }

    setSending(true);
    setError(null);
    try {
      const result = await sendPayment({
        senderWalletId: session.walletId,
        receiverWalletId: draft.receiverWalletId,
        amountCents: draft.amountCents,
        description: draft.description,
      });

      clearPaymentDraft();
      savePaymentResult({
        status: "success",
        debit: result.transaction.debit,
        credit: result.transaction.credit,
        fee: result.transaction.fee,
        receiverName: draft.receiverName,
      });
      router.push("/send/success");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Transfer failed";
      savePaymentResult({ status: "failure", message });
      router.push("/send/failure");
    } finally {
      setSending(false);
    }
  }

  if (!draft) {
    return (
      <SessionGuard>
        <AppShell title="Transfer Confirm">
          <LoadingState label="Loading transfer draft..." />
        </AppShell>
      </SessionGuard>
    );
  }

  return (
    <SessionGuard>
      <AppShell title="Transfer Confirm">
        <section className="card">
          <h3>Confirm Transfer</h3>
          <p className="muted">Recipient: {draft.receiverName}</p>
          <p className="muted">Wallet: {draft.walletNumber}</p>
          <p className="amount">{toRand(draft.amountCents)}</p>
          <p className="muted">Fee may apply based on service rules.</p>
          {error && <ErrorState label={error} />}
          <div className="grid-2">
            <Link href="/send"><button className="ghost">Edit</button></Link>
            <button onClick={onConfirm} disabled={sending}>{sending ? "Sending..." : "Confirm & Send"}</button>
          </div>
        </section>
      </AppShell>
    </SessionGuard>
  );
}

