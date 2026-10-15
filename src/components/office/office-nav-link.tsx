"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2 } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

/** Visibility is only a convenience; the page and API enforce access again. */
export function OfficeNavLink() {
  const { user, accountId, profileLoading } = useAuth();
  const pathname = usePathname();
  const [grant, setGrant] = useState<{ userId: string; accountId: string } | null>(null);

  useEffect(() => {
    if (!user || !accountId || profileLoading) return;
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const response = await fetch("/api/office/context", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const context = await response.json();
        if (
          active &&
          context.user?.id === user.id &&
          context.accountId === accountId
        ) {
          setGrant({ userId: user.id, accountId });
        }
      } catch {
        // An unavailable office must not interrupt the rest of the CRM.
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [user, accountId, profileLoading]);

  if (
    !user ||
    profileLoading ||
    !accountId ||
    grant?.userId !== user.id ||
    grant.accountId !== accountId
  ) {
    return null;
  }

  const selected = pathname === "/escritorio" || pathname.startsWith("/escritorio/");
  return (
    <li>
      <Link
        href="/escritorio"
        aria-current={selected ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors lg:py-2",
          selected
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Building2 className="size-4" aria-hidden="true" />
        Escritório
      </Link>
    </li>
  );
}
