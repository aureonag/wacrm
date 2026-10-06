// Small building blocks shared by the Afiliados screens (Dashboard, Relatórios,
// Desenvolvimento, Integrações): a titled panel and a labelled number tile.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  title,
  icon: Icon,
  hint,
  className,
  children,
}: {
  title?: string;
  icon?: LucideIcon;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-5", className)}>
      {title && (
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          {title}
        </h2>
      )}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className={cn(title || hint ? "mt-4" : "")}>{children}</div>
    </section>
  );
}

export function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <strong className="mt-1.5 block text-2xl font-bold text-foreground">{value}</strong>
    </div>
  );
}

const TONES = {
  good: "bg-emerald-500/15 text-emerald-500",
  warn: "bg-amber-500/15 text-amber-500",
  bad: "bg-red-500/15 text-red-500",
  info: "bg-sky-500/15 text-sky-500",
  muted: "bg-muted text-muted-foreground",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", TONES[tone])}>{children}</span>;
}

export const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const money = (cents: number) => brl.format(cents / 100);

/** "2026-09" → "09/2026". */
export const formatPeriod = (period: string) => period.split("-").reverse().join("/");
