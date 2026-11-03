// Public legal pages (privacy, terms, data deletion). Anonymous: they must open
// with no session, because Meta and Facebook users read them before signing in.
// Unlike the CRM, these may be indexed.

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" aria-label="Aureon">
            <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-7 w-auto" />
            <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-7 w-auto" />
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link href="/privacidade" className="hover:text-foreground">
              Privacidade
            </Link>
            <Link href="/termos" className="hover:text-foreground">
              Termos
            </Link>
            <Link href="/exclusao-de-dados" className="hover:text-foreground">
              Exclusão de dados
            </Link>
          </nav>
        </header>
        <main className="space-y-4 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_li]:text-muted-foreground [&_p]:text-muted-foreground">
          {children}
        </main>
      </div>
    </div>
  );
}
