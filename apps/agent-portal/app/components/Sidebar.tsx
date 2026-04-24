"use client";

import { usePathname, useRouter } from "next/navigation";

const NAV = [
  { label: "Dashboard", icon: "⌂", href: "/dashboard" },
  { label: "Cash In", icon: "⬇", href: "/cash-in" },
  { label: "Cash Out", icon: "⬆", href: "/cash-out" },
  { label: "Transactions", icon: "↕", href: "/transactions" },
  { label: "KYC Queue", icon: "📋", href: "/kyc" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const email =
    typeof window !== "undefined"
      ? (localStorage.getItem("agentEmail") ?? "Agent")
      : "Agent";

  const handleLogout = () => {
    localStorage.removeItem("agentToken");
    localStorage.removeItem("agentEmail");
    router.replace("/login");
  };

  return (
    <aside className="w-60 bg-[#0f172a] text-white flex flex-col shrink-0">
      <div className="px-6 py-5 border-b border-white/10">
        <h1 className="text-xl font-bold tracking-tight">Ubuntu</h1>
        <p className="text-xs text-gray-400 mt-0.5">Agent Portal</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <button
              key={item.label}
              onClick={() => router.push(item.href)}
              className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition
                ${active ? "bg-white/10 text-white font-medium" : "text-gray-400 hover:bg-white/5 hover:text-white"}`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <p className="text-xs text-gray-400 truncate mb-2">{email}</p>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-red-400 transition"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
