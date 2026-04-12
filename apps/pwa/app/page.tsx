"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "../lib/api-client";

export default function SplashPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace(getSession() ? "/dashboard" : "/welcome");
    }, 900);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <section className="hero">
      <div className="hero-box">
        <span className="pill">Ahava MVP</span>
        <h1>Money moves simply.</h1>
        <p className="muted">Loading secure wallet session...</p>
      </div>
    </section>
  );
}

