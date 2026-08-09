import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LevelFlip — Dealer Positioning Terminal",
  description: "Institutional options microstructure & dealer hedging flow terminal.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-canvas text-slate-200 antialiased">{children}</body>
    </html>
  );
}
