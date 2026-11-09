"use client";

// "Personalizar" a saved report: the cover (title, subtitle) and what it shows —
// which metrics, the day-by-day chart and an opening text. The numbers are not
// read again; they stay as they were saved.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DAILY_METRICS, METRICS, type DailyMetric, type MetricKey, type ReportSnapshot } from "@/lib/reportei/report";
import { INTRO_MAX, effectiveOptions, parseOptions } from "@/lib/reportei/template";
import { cn } from "@/lib/utils";

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function ReportEditDialog({
  reportId,
  title: initialTitle,
  subtitle: initialSubtitle,
  snapshot,
  onClose,
  onSaved,
}: {
  reportId: string;
  title: string;
  subtitle: string;
  snapshot: ReportSnapshot;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Operational.reportei.reportPage");
  const tm = useTranslations("Operational.reportei.reports");
  const tt = useTranslations("Operational.reportei.templatesPage");
  const current = effectiveOptions(snapshot.options);
  // A report generated without the daily series has no chart to turn on.
  const hasDaily = snapshot.accounts.some((a) => (a.daily?.length ?? 0) > 1);

  const [title, setTitle] = useState(initialTitle);
  const [subtitle, setSubtitle] = useState(initialSubtitle);
  const [metrics, setMetrics] = useState<MetricKey[]>(current.metrics);
  const [chart, setChart] = useState(current.chart && hasDaily);
  const [chartMetrics, setChartMetrics] = useState<DailyMetric[]>(current.chartMetrics);
  const [intro, setIntro] = useState(current.intro);
  const [saving, setSaving] = useState(false);

  const options = { metrics, chart, chartMetrics, intro };
  const valid = title.trim().length > 0 && parseOptions(options) !== null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), subtitle, options }),
      });
      if (!res.ok) return toast.error(t("saveError"));
      toast.success(t("saved"));
      onSaved();
    } catch {
      toast.error(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  const chip = (on: boolean) =>
    cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted/50");

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("customizeTitle")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t("coverTitle")}</span>
            <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t("coverSubtitle")}</span>
            <Input value={subtitle} maxLength={300} onChange={(e) => setSubtitle(e.target.value)} placeholder={t("coverSubtitlePlaceholder")} />
          </label>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">{tt("metricsLabel")}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt("metricsLabel")}>
              {METRICS.map((m) => (
                <button key={m} type="button" aria-pressed={metrics.includes(m)} onClick={() => setMetrics((cur) => toggle(cur, m))} className={chip(metrics.includes(m))}>
                  {tm(`metric_${m}`)}
                </button>
              ))}
            </div>
            {metrics.length === 0 && <p className="text-xs text-red-500">{tt("metricsRequired")}</p>}
          </div>

          <div className="space-y-1.5">
            <label className={cn("flex items-center gap-2 text-sm font-medium text-foreground", !hasDaily && "opacity-60")}>
              <input type="checkbox" checked={chart} disabled={!hasDaily} onChange={(e) => setChart(e.target.checked)} className="h-4 w-4 accent-primary" />
              {tt("chartLabel")}
            </label>
            {!hasDaily && <p className="text-xs text-muted-foreground">{t("noDailyData")}</p>}
            {chart && (
              <>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt("chartMetricsLabel")}>
                  {DAILY_METRICS.map((m) => (
                    <button key={m} type="button" aria-pressed={chartMetrics.includes(m)} onClick={() => setChartMetrics((cur) => toggle(cur, m))} className={chip(chartMetrics.includes(m))}>
                      {tm(`metric_${m}`)}
                    </button>
                  ))}
                </div>
                {chartMetrics.length === 0 && <p className="text-xs text-red-500">{tt("chartMetricsRequired")}</p>}
              </>
            )}
          </div>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{tt("introLabel")}</span>
            <Textarea value={intro} maxLength={INTRO_MAX} rows={3} onChange={(e) => setIntro(e.target.value)} placeholder={tt("introPlaceholder")} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {tt("cancel")}
          </Button>
          <Button disabled={saving || !valid} onClick={save}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {tt("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
