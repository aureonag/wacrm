// /r/[token] — public, read-only Reportei report. Anonymous: opens with no
// session, so it lives outside (auth) and (dashboard). The token is in the URL
// path, hence no-referrer, and the page must never be indexed.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function SharedReportLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="no-print">
          <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
          <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
        </div>
        {children}
      </div>
    </div>
  );
}
