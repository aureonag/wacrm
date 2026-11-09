"use client";

// "Escolher campanhas" of one linked ad account: the whole account, or only the
// campaigns ticked here. The choice limits every report and dashboard of the client.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Campaign {
  id: string;
  name: string;
  status: string;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function CampaignsDialog({
  clientId,
  integrationId,
  accountName,
  onClose,
  onSaved,
}: {
  clientId: string;
  integrationId: string;
  accountName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Operational.reportei.integrations");
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [whole, setWhole] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/operational/reportei/clients/${clientId}/integrations/${integrationId}/campaigns`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return setFailed(true);
        const body = (await res.json()) as { campaigns: Campaign[]; selected: string[] | null };
        setCampaigns(body.campaigns);
        setWhole(body.selected === null);
        setPicked(new Set(body.selected ?? []));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [clientId, integrationId]);

  const visible = useMemo(() => {
    const q = norm(query.trim());
    return (campaigns ?? []).filter((c) => !q || norm(c.name).includes(q));
  }, [campaigns, query]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/integrations/${integrationId}/campaigns`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignIds: whole ? null : [...picked] }),
      });
      if (!res.ok) return toast.error(t("campaignsSaveError"));
      toast.success(t("campaignsSaved"));
      onSaved();
    } catch {
      toast.error(t("campaignsSaveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("campaignsTitle", { name: accountName })}</DialogTitle>
        </DialogHeader>

        {failed && <p className="text-sm text-red-500">{t("campaignsError")}</p>}
        {!failed && campaigns === null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("campaignsLoading")}
          </p>
        )}

        {campaigns !== null && (
          <div className="space-y-3">
            <div className="flex gap-2" role="radiogroup" aria-label={t("campaignsScope")}>
              {[true, false].map((isWhole) => (
                <button
                  key={String(isWhole)}
                  type="button"
                  role="radio"
                  aria-checked={whole === isWhole}
                  onClick={() => setWhole(isWhole)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    whole === isWhole ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {isWhole ? t("campaignsWhole") : t("campaignsSome")}
                </button>
              ))}
            </div>

            {!whole && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("campaignsSearch")} className="h-9 pl-8 text-sm" />
                </div>
                {campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("campaignsNone")}</p>
                ) : (
                  <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {visible.map((c) => (
                      <li key={c.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                          <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-primary" />
                          <span className="min-w-0 flex-1 truncate text-foreground">{c.name}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{c.status.toLowerCase()}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">{t("campaignsPicked", { count: picked.size })}</p>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t("campaignsCancel")}
          </Button>
          <Button disabled={saving || campaigns === null || (!whole && picked.size === 0)} onClick={save}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("campaignsSave")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
