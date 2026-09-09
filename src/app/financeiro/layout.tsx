import type { Metadata } from "next";
import { FinanceiroShell } from "./financeiro-shell";

// Server layout whose only job is to declare "do not index" metadata —
// mirrors src/app/operational/layout.tsx exactly (see that file's
// comment for why this split exists: client components can't export
// metadata).
//
// Real folder (no parens) so pages under it resolve to /financeiro/*.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function FinanceiroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FinanceiroShell>{children}</FinanceiroShell>;
}
