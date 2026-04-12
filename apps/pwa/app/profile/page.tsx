"use client";

import { useEffect, useState } from "react";
import { AppShell, ErrorState, LoadingState, SessionGuard } from "../components";
import { ApiError, getKycStatus, getSession } from "../../lib/api-client";

type KycView = {
  id: string;
  kycTier: string;
  kycStatus: string;
  idType: string | null;
  updatedAt: string;
};

export default function ProfilePage() {
  const [kyc, setKyc] = useState<KycView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = getSession();
      if (!session) return;

      setLoading(true);
      setError(null);
      try {
        const data = await getKycStatus(session.userId);
        setKyc(data.kyc);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not load KYC profile");
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <SessionGuard>
      <AppShell title="Profile & KYC">
        {loading && <LoadingState label="Loading profile..." />}
        {!loading && error && <ErrorState label={error} />}

        {!loading && kyc && (
          <section className="card">
            <h3>KYC Status</h3>
            <p className="muted">Tier: {kyc.kycTier}</p>
            <p className="muted">Status: {kyc.kycStatus}</p>
            <p className="muted">Document Type: {kyc.idType || "Not submitted"}</p>
            <p className="muted">Last Updated: {new Date(kyc.updatedAt).toLocaleString()}</p>
            <button className="ghost" disabled>Manual review request (placeholder)</button>
          </section>
        )}
      </AppShell>
    </SessionGuard>
  );
}

