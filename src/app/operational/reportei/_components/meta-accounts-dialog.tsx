"use client";

// "Contas da Meta encontradas": lists the ad accounts Aureon's Meta system user
// can read, lets the team tick the ones that belong to this client and links
// them. Same flow as Reportei's account picker; the token never reaches here.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Loader2, LogIn, Megaphone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { cn } from "@/lib/utils";

interface AdAccount {
  id: string;
  name: string;
  currency: string | null;
  timezone: string | null;
  /** Company Meta connection that can read it (sent back when linking). */
  connectionId: string;
}

type State =
  | { kind: "loading" }
  | { kind: "notConfigured" }
  | { kind: "notConnected" }
  | { kind: "error"; reason: "token_invalid" | "permission" | "request_failed" }
  | { kind: "ready"; accounts: AdAccount[]; connectedAs: string | null };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function MetaAccountsDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  linkedIds,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  linkedIds: Set<string>;
  onLinked: () => void;
}) {
  const t = useTranslations("Operational.reportei.integrations");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Reset on each open, then load; state is set after the await in load().
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: "loading" });
    setQuery("");
    setSelected(new Set());
    (async () => {
      const res = await fetch("/api/operational/reportei/meta/ad-accounts");
      const data = (await res.json().catch(() => null)) as {
        configured?: boolean;
        connected?: boolean;
        connections?: { name: string | null }[];
        accounts?: AdAccount[];
        error?: string;
      } | null;
      if (cancelled) return;
      if (res.ok && data?.configured === false) return setState({ kind: "notConfigured" });
      if (res.ok && data?.connected === false) return setState({ kind: "notConnected" });
      if (res.ok && data?.accounts) return setState({ kind: "ready", accounts: data.accounts, connectedAs: (data.connections ?? []).map((c) => c.name).filter(Boolean).join(", ") || null });
      const reason = data?.error === "token_invalid" || data?.error === "permission" ? data.error : "request_failed";
      setState({ kind: "error", reason });
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const visible = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = norm(query.trim());
    return q ? state.accounts.filter((a) => norm(`${a.name} ${a.id}`).includes(q)) : state.accounts;
  }, [state, query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Full-page trip to Facebook and back; the page comes back with ?meta=connected
  // and reopens this picker. `meta` is dropped so it does not stack up.
  function connectFacebook() {
    const here = new URL(window.location.href);
    here.searchParams.delete("meta");
    const returnTo = `${here.pathname}${here.search}`;
    window.location.href = `/api/operational/reportei/meta/connect?returnTo=${encodeURIComponent(returnTo)}`;
  }

  async function link() {
    if (state.kind !== "ready" || selected.size === 0) return;
    setSaving(true);
    const accounts = state.accounts.filter((a) => selected.has(a.id));
    const res = await fetch(`/api/operational/reportei/clients/${clientId}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "meta_ads", accounts }),
    });
    setSaving(false);
    if (!res.ok) return toast.error(t("linkError"));
    toast.success(t("linked", { count: accounts.length }));
    onOpenChange(false);
    onLinked();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("foundTitle")}</DialogTitle>
          <DialogDescription>{t("foundHint", { name: clientName })}</DialogDescription>
        </DialogHeader>

        {state.kind === "loading" && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        )}
        {state.kind === "notConfigured" && <EmptyState title={t("notConfiguredTitle")} hint={t("notConfiguredHint")} className="min-h-40" />}
        {state.kind === "notConnected" && (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">{t("connectTitle")}</p>
            <p className="max-w-xs text-xs text-muted-foreground">{t("connectHint")}</p>
            <Button onClick={connectFacebook}>
              <LogIn className="h-4 w-4" />
              {t("connectButton")}
            </Button>
          </div>
        )}
        {state.kind === "error" && <EmptyState title={t("loadError")} hint={t(`hint_${state.reason}`)} className="min-h-40" />}

        {state.kind === "ready" && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchAccount")} className="h-9 border-border bg-muted pl-8 text-sm" />
            </div>
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{state.connectedAs ? t("connectedAs", { name: state.connectedAs }) : t("connected")}</span>
              <button type="button" onClick={connectFacebook} className="font-medium text-primary hover:underline">
                {t("switchAccount")}
              </button>
            </p>
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Megaphone className="h-4 w-4 text-primary" />
                Meta Ads
              </p>
              {visible.length === 0 ? (
                <EmptyState title={state.accounts.length === 0 ? t("noAccounts") : t("noResults")} className="min-h-24" />
              ) : (
                <div className="grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {visible.map((a) => {
                    const linked = linkedIds.has(a.id);
                    const on = selected.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        role="checkbox"
                        aria-checked={linked || on}
                        disabled={linked}
                        onClick={() => toggle(a.id)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                          on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                          linked && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border",
                            on || linked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                          )}
                        >
                          {(on || linked) && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{a.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{linked ? t("alreadyLinked") : a.id}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">{t("selectedCount", { count: selected.size })}</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button onClick={link} disabled={saving || state.kind !== "ready" || selected.size === 0}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("integrateSelected")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
