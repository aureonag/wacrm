"use client";

// The Nuvemshop card of Integrações: connect the store, see how the coupons and
// orders are going, sync by hand, disconnect. Used by the Aureon team and by a
// store's own people (when their role allows editing integrations).

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "./metric";
import { useWorkspace } from "./workspace";

interface Integration {
  id: string;
  store_name: string | null;
  store_url: string | null;
  status: "connected" | "error" | "revoked";
  last_error: string | null;
  webhooks_ok: boolean;
  installed_at: string;
}

interface Status {
  configured: boolean;
  integration: Integration | null;
  coupons: { approved: number; synced: number; failed: number; errors: { code: string; message: string }[] } | null;
  orders: { total: number; paid: number } | null;
  pending: Integration[];
}

const RESULTS = ["connected", "denied", "error", "other_store", "not_configured"] as const;

export function NuvemshopCard() {
  const t = useTranslations("Operational.affiliates.integrations");
  const n = useTranslations("Operational.affiliates.integrations.nuvemshop");
  const { apiBase, pageBase, mode, can } = useWorkspace();
  const base = `${apiBase}/integrations/nuvemshop`;
  const canEdit = can("integrations", "edit");

  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<"connect" | "sync" | "disconnect" | string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  // The Nuvemshop sends the person back here with ?nuvemshop=<result>: say what happened once, then clean the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("nuvemshop");
    if (!result) return;
    url.searchParams.delete("nuvemshop");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    if ((RESULTS as readonly string[]).includes(result)) {
      if (result === "connected") toast.success(n("result_connected"));
      else toast.error(n(`result_${result}` as "result_error"));
    }
  }, [n]);

  async function connect() {
    setBusy("connect");
    try {
      const res = await fetch(`${base}/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo: `${pageBase}/integracoes` }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast.error(res.status === 503 ? n("result_not_configured") : (data.error ?? n("openError")));
        setBusy(null);
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error(n("openError"));
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const res = await fetch(`${base}/sync`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        coupons?: { created: number; removed: number } | null;
        orders?: { stored: number };
      };
      if (!res.ok) toast.error(data.error ?? n("syncError"));
      else toast.success(n("syncDone", { created: data.coupons?.created ?? 0, removed: data.coupons?.removed ?? 0, orders: data.orders?.stored ?? 0 }));
    } catch {
      toast.error(n("syncError"));
    }
    setBusy(null);
    void load();
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      toast.success(n("disconnected"));
      setConfirmDisconnect(false);
    } catch {
      toast.error(n("disconnectError"));
    }
    setBusy(null);
    void load();
  }

  async function link(integrationId: string) {
    setBusy(integrationId);
    try {
      const res = await fetch(`${base}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) toast.error(data.error ?? n("linkError"));
      else toast.success(n("linked"));
    } catch {
      toast.error(n("linkError"));
    }
    setBusy(null);
    void load();
  }

  const integration = status?.integration ?? null;
  const connected = integration?.status === "connected";
  const withError = integration?.status === "error";
  const date = (iso: string) => new Date(iso).toLocaleDateString("pt-BR");

  return (
    <>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between">
          <Plug className="h-6 w-6 text-primary" />
          {connected ? <Badge tone="good">{t("connected")}</Badge> : withError ? <Badge tone="bad">{t("withError")}</Badge> : <Badge tone="muted">{t("notConnected")}</Badge>}
        </div>
        <h2 className="mt-3 text-base font-semibold text-foreground">{n("name")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{n("description")}</p>

        {failed && <p className="mt-3 text-sm text-red-400">{n("loadError")}</p>}
        {!status && !failed && <Loader2 className="mt-4 h-4 w-4 animate-spin text-muted-foreground" />}

        {status && !status.configured && (
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
            {mode === "staff" ? n("notConfigured") : n("notConfiguredStore")}
          </p>
        )}

        {integration && (
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{n("storeLabel")}:</dt>
              <dd className="min-w-0 truncate font-medium text-foreground">
                {integration.store_url ? (
                  <a href={integration.store_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {integration.store_name ?? integration.store_url}
                  </a>
                ) : (
                  (integration.store_name ?? "—")
                )}
              </dd>
            </div>
            <p className="text-xs text-muted-foreground">{n("installedOn", { date: date(integration.installed_at) })}</p>
            {integration.last_error && <p className="text-xs text-red-400">{integration.last_error}</p>}
            {connected && !integration.webhooks_ok && <p className="text-xs text-amber-500">{n("webhooksWarn")}</p>}
            {connected && status?.coupons && (
              <p className="text-foreground">{n("couponsLine", { synced: status.coupons.synced, approved: status.coupons.approved })}</p>
            )}
            {status?.coupons && status.coupons.failed > 0 && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <strong>{n("couponsFailed", { count: status.coupons.failed })}</strong>
                <ul className="mt-1 list-disc pl-4">
                  {status.coupons.errors.map((e, i) => (
                    <li key={`${e.code}-${i}`}>
                      <span className="font-mono">{e.code}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {connected && status?.orders && <p className="text-muted-foreground">{n("ordersLine", { total: status.orders.total, paid: status.orders.paid })}</p>}
          </dl>
        )}

        {status?.configured && canEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(!integration || withError) && (
              <Button type="button" size="sm" onClick={connect} disabled={busy !== null}>
                {busy === "connect" ? n("opening") : integration ? n("reconnect") : n("connect")}
              </Button>
            )}
            {connected && (
              <Button type="button" variant="outline" size="sm" onClick={sync} disabled={busy !== null}>
                {busy === "sync" ? n("syncing") : n("syncNow")}
              </Button>
            )}
            {integration && !confirmDisconnect && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
                {n("disconnect")}
              </Button>
            )}
          </div>
        )}

        {confirmDisconnect && (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="text-foreground">{n("disconnectConfirm")}</p>
            <div className="mt-2 flex gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={disconnect} disabled={busy !== null}>
                {n("disconnectYes")}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>
                {n("disconnectNo")}
              </Button>
            </div>
          </div>
        )}
      </section>

      {mode === "staff" && !integration && status && status.pending.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5 md:col-span-2">
          <h3 className="text-sm font-semibold text-foreground">{n("pendingTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{n("pendingHint")}</p>
          <ul className="mt-3 divide-y divide-border">
            {status.pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate">
                  <strong className="text-foreground">{p.store_name ?? p.store_url ?? p.id}</strong>
                  {p.store_url && <span className="ml-2 text-xs text-muted-foreground">{p.store_url}</span>}
                  <span className="ml-2 text-xs text-muted-foreground">{date(p.installed_at)}</span>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => link(p.id)} disabled={busy !== null}>
                  {busy === p.id ? n("syncing") : n("link")}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
