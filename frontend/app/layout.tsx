import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "LevelFlip — Dealer Positioning Terminal",
  description: "Institutional options microstructure & dealer hedging flow terminal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      {/* suppressHydrationWarning: browser extensions (Grammarly etc.) inject
          data-* attributes into <body> after SSR — mismatch is expected */}
      <body
        className={`${inter.variable} ${jetbrains.variable} bg-canvas font-sans text-slate-200 antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
