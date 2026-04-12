"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell, SessionGuard } from "../../components";
import { getPaymentResult } from "../../../lib/api-client";

type FailurePayload = {
  status: "failure";
  message: string;
};

export default function TransferFailurePage() {
  const [message, setMessage] = useState("Transfer could not be completed.");

  useEffect(() => {
    const payload = getPaymentResult<FailurePayload>();
    if (payload?.message) {
      setMessage(payload.message);
    }
  }, []);

  return (
    <SessionGuard>
      <AppShell title="Transfer Failure">
        <section className="card">
          <span className="pill" style={{ background: "#fde7e5", color: "#972a20" }}>Failed</span>
          <h3>Transfer failed</h3>
          <p className="state error">{message}</p>
          <div className="grid-2">
            <Link href="/send"><button>Try Again</button></Link>
            <Link href="/dashboard"><button className="ghost">Back Home</button></Link>
          </div>
        </section>
      </AppShell>
    </SessionGuard>
  );
}

