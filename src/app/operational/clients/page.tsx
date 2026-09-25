"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, ChevronDown, Search } from "lucide-react";
import type { ScopeSection } from "@/lib/contracts/scope";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";

interface ActiveClient {
  id: string;
  razaoSocial: string;
  cnpj: string;
  signedAt: string | null;
  openTasks: number;
  sections: ScopeSection[];
}

function brDate(value: string | null): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export default function ActiveClientsPage() {
  const t = useTranslations("Operational.clients");
  const [state, setState] = useState<"loading" | "error" | ActiveClient[]>("loading");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/operational/clients");
      if (cancelled) return;
      if (!res.ok) return setState("error");
      const data = (await res.json()) as { clients: ActiveClient[] };
      setState(data.clients);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clients = useMemo(() => {
    if (!Array.isArray(state)) return [];
    const q = norm(query.trim());
    return q ? state.filter((c) => norm(`${c.razaoSocial} ${c.cnpj}`).includes(q)) : state;
  }, [state, query]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <div className="relative w-full sm:w-80">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="h-9 border-border bg-muted pl-8 text-sm text-foreground"
        />
      </div>

      {state === "loading" ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : state === "error" ? (
        <EmptyState title={t("error")} className="min-h-40" />
      ) : clients.length === 0 ? (
        <EmptyState title={query.trim() ? t("noResults") : t("empty")} className="min-h-40" />
      ) : (
        <ul className="space-y-3">
          {clients.map((c) => {
            const open = openId === c.id;
            const service = c.sections.find((s) => s.key === "service");
            return (
              <li key={c.id} className="rounded-xl border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : c.id)}
                  aria-expanded={open}
                  className="flex w-full items-start gap-3 p-4 text-left"
                >
                  <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{c.razaoSocial}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {c.cnpj} · {t("signedAt", { date: brDate(c.signedAt) })}
                    </p>
                    {service && service.lines[0] && (
                      <p className="mt-1.5 truncate text-xs text-foreground/80">{service.lines[0]}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {t("openTasks", { count: c.openTasks })}
                  </span>
                  <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
                </button>

                {open && (
                  <div className="grid gap-4 border-t border-border p-4 md:grid-cols-2">
                    {c.sections.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("noScope")}</p>
                    ) : (
                      c.sections.map((s) => (
                        <section key={s.key}>
                          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.heading}</h4>
                          <ul className="space-y-1.5 text-sm text-foreground">
                            {s.lines.map((line, i) => (
                              <li key={i} className="leading-snug">
                                {line}
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
