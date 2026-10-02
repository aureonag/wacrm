// /inscricao/<campaignId> — public sign-up page for affiliates. Anonymous.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Inscrição na campanha",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function SignupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center gap-6 bg-background px-4 py-10">
      <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
      <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
      {children}
    </div>
  );
}
