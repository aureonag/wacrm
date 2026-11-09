"use client";

// The round photo of a client: its logo, or the initials on a colour taken from
// the name. Optionally a small health badge on the corner, like Reportei's cards.

import { HeartPulse } from "lucide-react";
import { hueOf, initials, type Health } from "@/lib/reportei/client-card";
import { cn } from "@/lib/utils";

const BADGE: Record<Health, string> = {
  ok: "bg-emerald-500",
  attention: "bg-amber-500",
  none: "bg-muted-foreground/40",
};

export function ClientAvatar({
  name,
  logoUrl,
  size = 64,
  health,
  healthTitle,
  className,
}: {
  name: string;
  logoUrl: string | null;
  size?: number;
  health?: Health;
  healthTitle?: string;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-block shrink-0", className)} style={{ width: size, height: size }}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a public storage URL of any origin; sizes are fixed
        <img src={logoUrl} alt="" width={size} height={size} className="h-full w-full rounded-full border border-border bg-white object-cover" />
      ) : (
        <span
          aria-hidden
          className="flex h-full w-full items-center justify-center rounded-full font-semibold text-white"
          style={{ background: `hsl(${hueOf(name)} 55% 45%)`, fontSize: Math.round(size * 0.36) }}
        >
          {initials(name)}
        </span>
      )}
      {health && (
        <span
          title={healthTitle}
          className={cn("absolute -right-1 -top-1 flex items-center justify-center rounded-full text-white ring-2 ring-card", BADGE[health])}
          style={{ width: Math.round(size * 0.34), height: Math.round(size * 0.34) }}
        >
          <HeartPulse style={{ width: "62%", height: "62%" }} />
        </span>
      )}
    </span>
  );
}
