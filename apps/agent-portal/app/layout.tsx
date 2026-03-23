import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ahava Agent Portal",
  description: "Agent management dashboard for Ahava eWallet",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
