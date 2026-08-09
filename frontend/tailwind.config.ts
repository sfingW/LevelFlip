import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0B0E14",
        card: "#1E293B",
        edge: "#334155",
        callwall: "#EF4444",
        putwall: "#22C55E",
        flip: "#F59E0B",
        maxpain: "#A78BFA",
        emmove: "#38BDF8",
        muted: "#94A3B8",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      keyframes: {
        "badge-green": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(34,197,94,0.55)" },
          "50%": { boxShadow: "0 0 0 6px rgba(34,197,94,0)" },
        },
        "badge-red": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(239,68,68,0.55)" },
          "50%": { boxShadow: "0 0 0 6px rgba(239,68,68,0)" },
        },
        "glow-amber": {
          "0%, 100%": { boxShadow: "0 0 12px rgba(245,158,11,0.35)" },
          "50%": { boxShadow: "0 0 26px rgba(245,158,11,0.75)" },
        },
      },
      animation: {
        "badge-green": "badge-green 1.6s ease-in-out infinite",
        "badge-red": "badge-red 1.6s ease-in-out infinite",
        "glow-amber": "glow-amber 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
