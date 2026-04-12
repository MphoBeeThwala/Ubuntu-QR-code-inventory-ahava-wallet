"use client";

import { useRouter } from "next/navigation";
import { AppShell, SessionGuard } from "../components";
import { clearSession } from "../../lib/api-client";

export default function SettingsPage() {
  const router = useRouter();

  function onLogout() {
    clearSession();
    router.push("/welcome");
  }

  return (
    <SessionGuard>
      <AppShell title="Settings">
        <section className="card">
          <h3>Preferences</h3>
          <p className="muted">Notifications, language, and security settings will expand in later phases.</p>
          <button className="ghost" disabled>Language: English</button>
        </section>

        <section className="card">
          <h3>Session</h3>
          <button onClick={onLogout}>Logout</button>
        </section>
      </AppShell>
    </SessionGuard>
  );
}

