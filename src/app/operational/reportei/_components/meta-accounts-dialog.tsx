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

interface ConnectionSummary {
  id: string;
  name: string | null;
  status: "connected" | "error" | "revoked";
}

type State =
  | { kind: "loading" }
  | { kind: "notConfigured" }
  | { kind: "notConnected" }
  | { kind: "error"; reason: "token_invalid" | "permission" | "request_failed"; detail?: string }
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
  const [canAuthorize, setCanAuthorize] = useState(false);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Reset the selection for each opening or retry.
    setState({ kind: "loading" });
    setQuery("");
    setSelected(new Set());
    (async () => {
      try {
      const res = await fetch("/api/operational/reportei/meta/ad-accounts");
      const data = (await res.json().catch(() => null)) as {
        configured?: boolean;
        connected?: boolean;
        oauthConfigured?: boolean;
        connections?: ConnectionSummary[];
        accounts?: AdAccount[];
        error?: string;
        detail?: string;
      } | null;
      if (cancelled) return;
      setCanAuthorize(data?.oauthConfigured ?? data?.configured === true);
      setConnections(data?.connections ?? []);
      if (res.ok && data?.connected && Array.isArray(data.accounts)) return setState({ kind: "ready", accounts: data.accounts, connectedAs: (data.connections ?? []).filter((c) => c.status === "connected").map((c) => c.name).filter(Boolean).join(", ") || null });
      if (res.ok && data?.configured === false && !data.connected) return setState({ kind: "notConfigured" });
      if (res.ok && data?.connected === false) return setState({ kind: "notConnected" });
      const reason = data?.error === "token_invalid" || data?.error === "permission" ? data.error : "request_failed";
      setState({ kind: "error", reason, detail: data?.detail });
      } catch {
        if (!cancelled) setState({ kind: "error", reason: "request_failed" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, retry]);

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
  function connectFacebook(connectionId?: string) {
    const here = new URL(window.location.href);
    here.searchParams.delete("meta");
    const returnTo = `${here.pathname}${here.search}`;
    const params = new URLSearchParams({ returnTo });
    if (connectionId) params.set("reconnect", connectionId);
    window.location.href = `/api/operational/reportei/meta/connect?${params}`;
  }

  async function link() {
    try {
    if (state.kind !== "ready" || selected.size === 0) return;
    setSaving(true);
    const accounts = state.accounts.filter((a) => selected.has(a.id)).map((a) => ({ id: a.id, connectionId: a.connectionId }));
    const res = await fetch(`/api/operational/reportei/clients/${clientId}/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "meta_ads", accounts }),
    });
    setSaving(false);
    const body = (await res.json().catch(() => null)) as { results?: { id: string; result: string; state?: string; reason?: string }[] } | null;
    // The server proved each account with Meta before linking it; say exactly what happened to each.
    if (!body?.results) return toast.error(t("linkError"));
    const count = (r: string) => body.results!.filter((x) => x.result === r).length;
    if (count("linked") > 0) toast.success(t("linked", { count: count("linked") }));
    if (count("recovered") > 0) toast.success(t("linkRecovered", { count: count("recovered") }));
    if (count("already_linked") > 0 && count("linked") + count("recovered") === 0) toast.message(t("linkAlready"));
    if (body.results.some((x) => x.state === "no_delivery")) toast.message(t("linkNoDelivery"));
    for (const failed of body.results.filter((x) => x.result === "failed")) {
      const name = state.accounts.find((a) => a.id === failed.id)?.name ?? failed.id;
      toast.error(`${name}: ${t(`linkReason_${failed.reason ?? "failed"}`)}`);
    }
    if (count("failed") === body.results.length) return;
    onOpenChange(false);
    onLinked();
    } catch {
      toast.error(t("linkError"));
    } finally {
      setSaving(false);
    }
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
            <Button disabled={!canAuthorize} onClick={() => connectFacebook()}>
              <LogIn className="h-4 w-4" />
              {t("connectButton")}
            </Button>
          </div>
        )}
        {state.kind === "error" && (
          <div className="space-y-3">
            <EmptyState title={t("loadError")} hint={t(`hint_${state.reason}`)} className="min-h-40" />
            <Button variant="outline" onClick={() => setRetry((n) => n + 1)}>{t("retryAccounts")}</Button>
          </div>
        )}

        {state.kind !== "loading" && connections.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            {connections.map((connection) => (
              <div key={connection.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{connection.name ?? t("connectionFallback")}</span>
                <Button size="sm" variant="outline" disabled={!canAuthorize} onClick={() => connectFacebook(connection.id)}>{t("reconnect")}</Button>
              </div>
            ))}
            {!canAuthorize && <p className="text-xs text-muted-foreground">{t("loginUnavailable")}</p>}
          </div>
        )}

        {state.kind === "ready" && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchAccount")} className="h-9 border-border bg-muted pl-8 text-sm" />
            </div>
            <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{state.connectedAs ? t("connectedAs", { name: state.connectedAs }) : t("connected")}</span>
              <button type="button" disabled={!canAuthorize} onClick={() => connectFacebook()} className="font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50">
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
