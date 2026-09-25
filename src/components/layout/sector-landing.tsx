"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { landingPathFor } from "@/lib/auth/landing";

const DONE_KEY = "aureon:sector-landing-done";

/**
 * Headless. On the first arrival at /dashboard in a browser session, sends
 * people whose sectors are only Operacional (Criação/Mídia/Social) to the
 * Operacional dashboard. Runs once per session so that opening the CRM
 * dashboard later on purpose is never overridden.
 */
export function SectorLanding() {
  const { profile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname !== "/dashboard" || !profile?.id) return;
    try {
      if (sessionStorage.getItem(DONE_KEY)) return;
      sessionStorage.setItem(DONE_KEY, "1");
    } catch {
      // No storage (private mode): still fine to try once per mount.
    }
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("user_sectors")
        .select("sectors(name)")
        .eq("profile_id", profile.id);
      if (cancelled) return;
      const names = ((data ?? []) as unknown as { sectors: { name: string } | { name: string }[] | null }[]).flatMap((r) =>
        Array.isArray(r.sectors) ? r.sectors.map((s) => s.name) : r.sectors ? [r.sectors.name] : [],
      );
      const target = landingPathFor(names);
      if (target) router.replace(target);
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, profile?.id, router]);

  return null;
}
