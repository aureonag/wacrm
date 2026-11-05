"use client";

// "Gerar relatório": picks the period (a preset or free dates), optionally the
// comparison with the previous period, reads Meta now and saves the numbers.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PERIODS, resolvePeriod, type Period } from "@/lib/reportei/periods";
import { isValidRange } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";
import { useTemplates } from "./use-templates";

type Choice = Period | "custom";

export function GenerateReportDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
}) {
  const t = useTranslations("Operational.reportei.reports");
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [choice, setChoice] = useState<Choice>("last_30d");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [compare, setCompare] = useState(true);
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const { templates } = useTemplates();

  const today = resolvePeriod("last_7d").until;
  const customOk = choice !== "custom" || isValidRange(since, until, today);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/operational/reportei/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          period: choice === "custom" ? { since, until } : choice,
          compare,
          title: title.trim() || undefined,
          templateId: templateId || undefined,
        }),
      });
      if (res.status === 502) return toast.error(t("createNoAccount"));
      if (!res.ok) return toast.error(t("createError"));
      const { id } = (await res.json()) as { id: string };
      router.push(`/operational/reportei/relatorios/${id}`);
    } catch {
      toast.error(t("createError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("generateTitle")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t("titleLabel")}</span>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder", { name: clientName })} />
          </label>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t("periodLabel")}</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("periodLabel")}>
              {[...PERIODS, "custom" as const].map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={choice === p}
                  onClick={() => setChoice(p)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    choice === p ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {t(`period_${p}`)}
                </button>
              ))}
            </div>
          </div>

          {choice === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">{t("from")}</span>
                <Input type="date" value={since} max={today} onChange={(e) => setSince(e.target.value)} />
              </label>
              <label className="space-y-1.5 text-sm">
                <span className="text-muted-foreground">{t("to")}</span>
                <Input type="date" value={until} max={today} onChange={(e) => setUntil(e.target.value)} />
              </label>
              {since && until && !customOk && <p className="col-span-2 text-xs text-red-500">{t("invalidRange")}</p>}
            </div>
          )}

          {templates && templates.length > 0 && (
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-foreground">{t("templateLabel")}</span>
              <select
                value={templateId}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  // The template brings its own comparison default; the box below can still change it.
                  const picked = templates.find((x) => x.id === e.target.value);
                  setCompare(picked ? picked.compare : true);
                }}
              >
                <option value="">{t("templateDefault")}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t("compare")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button disabled={saving || !customOk || (choice === "custom" && (!since || !until))} onClick={create}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                {t("creating")}
              </>
            ) : (
              t("create")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
