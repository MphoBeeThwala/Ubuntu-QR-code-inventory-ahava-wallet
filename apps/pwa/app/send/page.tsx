"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell, ErrorState, SessionGuard } from "../components";
import { ApiError, lookupWallet, savePaymentDraft, toRand } from "../../lib/api-client";

export default function SendPage() {
  const router = useRouter();
  const [walletNumber, setWalletNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [lookupName, setLookupName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLookup() {
    setBusy(true);
    setError(null);
    try {
      const result = await lookupWallet(walletNumber);
      setLookupName(result.wallet.holderName);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Wallet lookup failed");
      }
      setLookupName(null);
    } finally {
      setBusy(false);
    }
  }

  async function onContinue(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const amountCents = Math.round((Number(amount) || 0) * 100);
    if (amountCents <= 0) {
      setError("Amount must be greater than 0");
      return;
    }

    try {
      const recipient = await lookupWallet(walletNumber);
      savePaymentDraft({
        walletNumber,
        receiverWalletId: recipient.wallet.id,
        receiverName: recipient.wallet.holderName,
        amountCents,
        description,
      });
      router.push("/send/confirm");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to prepare transfer");
      }
    }
  }

  return (
    <SessionGuard>
      <AppShell title="Send Money">
        <section className="card">
          <form onSubmit={onContinue}>
            <label>
              Recipient Wallet Number
              <input value={walletNumber} onChange={(e) => setWalletNumber(e.target.value)} required placeholder="AHV-XXXXXX" />
            </label>
            <button type="button" className="ghost" onClick={onLookup} disabled={busy || !walletNumber}>
              {busy ? "Checking..." : "Lookup Recipient"}
            </button>

            {lookupName && <p className="state loading">Recipient: {lookupName}</p>}

            <label>
              Amount (ZAR)
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </label>
            {amount && !Number.isNaN(Number(amount)) && Number(amount) > 0 && (
              <p className="muted">You are sending {toRand(Math.round(Number(amount) * 100))}</p>
            )}

            <label>
              Description
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional reference" />
            </label>

            {error && <ErrorState label={error} />}
            <button type="submit">Continue to Confirm</button>
          </form>
        </section>
      </AppShell>
    </SessionGuard>
  );
}

