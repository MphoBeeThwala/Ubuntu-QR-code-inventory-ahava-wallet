import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, Lora } from "next/font/google";
import "./globals.css";

const heading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading" });
const body = Lora({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Ahava Wallet PWA",
  description: "Ahava MVP wallet client",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable}`}>{children}</body>
    </html>
  );
}

