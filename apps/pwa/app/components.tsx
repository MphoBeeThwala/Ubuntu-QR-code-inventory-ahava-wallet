"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { clearSession, getSession } from "../lib/api-client";

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const pathname = usePathname();
  const router = useRouter();

  function onLogout() {
    clearSession();
    router.push("/welcome");
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="brand">Ahava</p>
          <h1>{title}</h1>
        </div>
        <button className="ghost" onClick={onLogout}>Logout</button>
      </header>
      <main className="content">{children}</main>
      <nav className="tabs">
        <Link className={pathname === "/dashboard" ? "active" : ""} href="/dashboard">Home</Link>
        <Link className={pathname.startsWith("/send") ? "active" : ""} href="/send">Send</Link>
        <Link className={pathname.startsWith("/history") ? "active" : ""} href="/history">History</Link>
        <Link className={pathname.startsWith("/notifications") ? "active" : ""} href="/notifications">Alerts</Link>
        <Link className={pathname.startsWith("/profile") ? "active" : ""} href="/profile">Profile</Link>
      </nav>
    </div>
  );
}

export function SessionGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!getSession()) {
      router.replace("/login");
      setAllowed(false);
      return;
    }
    setAllowed(true);
  }, [router]);

  if (allowed !== true) return null;
  return <>{children}</>;
}

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return <p className="state loading">{label}</p>;
}

export function EmptyState({ label }: { label: string }) {
  return <p className="state empty">{label}</p>;
}

export function ErrorState({ label }: { label: string }) {
  return <p className="state error">{label}</p>;
}

