// /portal — affiliate portal. Outside the CRM shells: portal users have no CRM
// profile. Never indexed, and no referrer leaks.

import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Portal Aureon",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
