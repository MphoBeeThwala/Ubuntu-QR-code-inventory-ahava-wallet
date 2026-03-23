"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();
  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("agentToken") : null;
    router.replace(token ? "/dashboard" : "/login");
  }, [router]);
  return null;
}
