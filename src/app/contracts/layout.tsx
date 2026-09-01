// ============================================================
// /contracts/[token] layout — minimal full-bleed shell, mirrors
// /join/layout.tsx: this page must render for anonymous clients
// with no session, so it lives outside (auth) and (dashboard).
//
// Referrer-Policy: no-referrer — the plaintext contract token
// lives in the URL path (see /join/layout.tsx for the same
// reasoning applied to invite tokens).
// ============================================================

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ContractsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <img
        src="/brand/aureon-logo-white.png"
        alt="Aureon"
        className="aureon-logo aureon-logo--dark h-7 w-auto"
      />
      <img
        src="/brand/aureon-logo-black.png"
        alt="Aureon"
        className="aureon-logo aureon-logo--light h-7 w-auto"
      />
      {children}
    </div>
  );
}
