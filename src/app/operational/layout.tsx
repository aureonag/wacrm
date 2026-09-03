import type { Metadata } from "next";
import { OperationalShell } from "./operational-shell";

// Server layout whose only job is to declare "do not index" metadata —
// mirrors src/app/(dashboard)/layout.tsx exactly (see that file's comment
// for why this split exists: client components can't export metadata).
//
// Real folder (no parens) — this must be a genuine URL segment so pages
// under it resolve to /operational/*. A route GROUP `(operational)` would
// collapse away and collide with `(dashboard)/dashboard` at `/dashboard`
// (caught by the Next.js build: "two parallel pages resolve to the same
// path").
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

export default function OperationalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OperationalShell>{children}</OperationalShell>;
}
