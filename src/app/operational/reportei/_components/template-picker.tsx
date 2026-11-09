"use client";

// The list of templates, the same wherever a report is started or templates are
// browsed: "Templates Reportei" (the four that come with the system), "Templates de
// especialistas" (people of the team, with their photo) and "Meus templates".

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Flag, LayoutTemplate, Rocket, Search, Settings, ShoppingCart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { REPORTEI_TEMPLATES, type TemplateGroup, type TemplateLayout } from "@/lib/reportei/doc-templates";
import type { TemplateListItem } from "@/lib/reportei/template";
import { cn } from "@/lib/utils";
import { ClientAvatar } from "./client-avatar";

export interface PickerTemplate {
  id: string;
  name: string;
  description: string;
  group: TemplateGroup;
  /** Null for the older templates that only choose metrics (they cannot make a document report). */
  layout: TemplateLayout | null;
  avatarUrl: string | null;
}

const BUILTIN_ICON: Record<string, { icon: typeof LayoutTemplate; tint: string }> = {
  "builtin:padrao": { icon: LayoutTemplate, tint: "bg-blue-500/15 text-blue-600" },
  "builtin:ecommerce": { icon: ShoppingCart, tint: "bg-orange-500/15 text-orange-600" },
  "builtin:recebidas": { icon: Flag, tint: "bg-slate-500/15 text-slate-600 dark:text-slate-300" },
  "builtin:trafego-pago": { icon: Rocket, tint: "bg-emerald-500/15 text-emerald-600" },
};

/** The four built-in templates plus the ones of the account. `items` is null while loading. */
export function usePickerTemplates() {
  const [saved, setSaved] = useState<TemplateListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/operational/reportei/templates");
      if (!res.ok) throw new Error("load");
      setSaved(((await res.json()) as { templates: TemplateListItem[] }).templates);
      setFailed(false);
    } catch {
      setFailed(true);
      setSaved((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    // Initial fetch; setState happens after the await, not synchronously.
    void reload();
  }, [reload]);

  const items = useMemo<PickerTemplate[] | null>(() => {
    if (saved === null) return null;
    const builtin: PickerTemplate[] = REPORTEI_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, group: "reportei", layout: t.layout, avatarUrl: null }));
    const own: PickerTemplate[] = saved.map((t) => ({
      id: t.id,
      name: t.kind === "expert" ? (t.ownerName ?? t.name) : t.name,
      description: t.description,
      group: t.kind,
      layout: t.layout,
      avatarUrl: t.ownerAvatarUrl,
    }));
    return [...builtin, ...own];
  }, [saved]);

  return { items, failed, reload };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const LABEL = "mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

function Card({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn("flex w-full items-start gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:bg-muted/40", selected ? "border-primary ring-1 ring-primary" : "border-border")}
    >
      {children}
    </button>
  );
}

export function TemplatePicker({
  items,
  value,
  onChange,
  manageHref,
  usage,
}: {
  items: PickerTemplate[] | null;
  value: string | null;
  onChange: (id: string) => void;
  /** Shows the "Gerenciar templates" link when set. */
  manageHref?: string;
  /** Reports generated per template; shows "N usos" and the "Popular" tag on the most used. */
  usage?: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const [expertsOpen, setExpertsOpen] = useState(true);
  const [showAllMine, setShowAllMine] = useState(false);

  const shown = useMemo(() => {
    const q = norm(query.trim());
    return (items ?? []).filter((t) => !q || norm(`${t.name} ${t.description}`).includes(q));
  }, [items, query]);

  const reportei = shown.filter((t) => t.group === "reportei");
  const experts = shown.filter((t) => t.group === "expert");
  const mine = shown.filter((t) => t.group === "mine");
  const top = usage ? Object.entries(usage).sort((a, b) => b[1] - a[1])[0] : undefined;
  const popularId = top && top[1] > 0 ? top[0] : null;
  /** The small "Popular · N usos" line under a template. */
  const uses = (id: string) => {
    if (!usage) return null;
    const n = usage[id] ?? 0;
    return (
      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {popularId === id && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">Popular</span>}
        {n} {n === 1 ? "uso" : "usos"}
      </span>
    );
  };
  const minePage = showAllMine || query.trim() ? mine : mine.slice(0, 4);

  return (
    <div className="space-y-6">
      {manageHref && (
        <div className="flex justify-end">
          <Link href={manageHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <Settings className="h-4 w-4" />
            Gerenciar templates
          </Link>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar template..." className="h-10 bg-muted pl-9" />
      </div>

      {items === null && <p className="text-sm text-muted-foreground">Carregando templates…</p>}

      {reportei.length > 0 && (
        <section>
          <p className={LABEL}>Templates Reportei</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {reportei.map((t) => {
              const { icon: Icon, tint } = BUILTIN_ICON[t.id] ?? BUILTIN_ICON["builtin:padrao"];
              return (
                <Card key={t.id} selected={value === t.id} onClick={() => onChange(t.id)}>
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tint)}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{t.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{t.description}</span>
                    {uses(t.id)}
                  </span>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {experts.length > 0 && (
        <section className="rounded-xl border border-border bg-card/50">
          <button type="button" onClick={() => setExpertsOpen((o) => !o)} aria-expanded={expertsOpen} className="flex w-full items-center justify-between px-4 py-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Templates de especialistas</span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expertsOpen && "rotate-180")} />
          </button>
          {expertsOpen && (
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
              {experts.map((t) => (
                <Card key={t.id} selected={value === t.id} onClick={() => onChange(t.id)}>
                  <ClientAvatar name={t.name} logoUrl={t.avatarUrl} size={44} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{t.name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{t.description}</span>
                    {uses(t.id)}
                  </span>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <p className={LABEL}>Meus templates</p>
        {mine.length === 0 && items !== null ? (
          <p className="text-sm text-muted-foreground">{query.trim() ? "Nenhum template encontrado." : "Você ainda não tem templates. Salve um relatório como template para ele aparecer aqui."}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {minePage.map((t) => (
              <Card key={t.id} selected={value === t.id} onClick={() => onChange(t.id)}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <LayoutTemplate className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{t.name}</span>
                  {t.description && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{t.description}</span>}
                  {uses(t.id)}
                </span>
              </Card>
            ))}
          </div>
        )}
        {!query.trim() && mine.length > 4 && (
          <button type="button" onClick={() => setShowAllMine((s) => !s)} className="mx-auto mt-3 block text-sm font-medium text-primary hover:underline">
            {showAllMine ? "Mostrar menos" : "Mostrar mais"}
          </button>
        )}
      </section>
    </div>
  );
}
