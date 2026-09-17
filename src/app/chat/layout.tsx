import type { Metadata } from "next";
import { ChatShell } from "./chat-shell";

// Server layout whose only job is to declare "do not index" metadata —
// mirrors src/app/financeiro/layout.tsx (client components can't
// export metadata).
//
// Real folder (no parens) so pages under it resolve to /chat/*.
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

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatShell>{children}</ChatShell>;
}
