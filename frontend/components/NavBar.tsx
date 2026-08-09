"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BoltIcon } from "@/components/icons";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/terminal", label: "Terminal" },
];

/** Shared top navigation: brand + page links, sticky across pages. */
export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center justify-between border-b border-edge bg-card/60 px-4 py-2.5 backdrop-blur sm:px-6">
      <Link href="/" className="flex items-center gap-2.5" aria-label="LevelFlip home">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-flip to-orange-600 text-slate-950 shadow-[0_0_14px_rgba(245,158,11,0.4)]">
          <BoltIcon className="h-4 w-4" />
        </div>
        <div className="text-sm font-black tracking-tight text-slate-100">
          LEVEL<span className="text-flip">FLIP</span>
        </div>
      </Link>

      <div className="flex items-center gap-1">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition ${
                active
                  ? "bg-flip/15 text-flip"
                  : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
