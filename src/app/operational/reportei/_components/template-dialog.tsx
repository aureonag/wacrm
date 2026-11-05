"use client";

// Create or edit a report template: name, which metrics appear, the day-by-day
// chart (and which metrics it can switch between), comparison on by default,
// and an optional intro text.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DAILY_METRICS, METRICS, type DailyMetric, type MetricKey } from "@/lib/reportei/report";
import { DEFAULT_OPTIONS, INTRO_MAX, NAME_MAX, parseOptions, type Template } from "@/lib/reportei/template";
import { cn } from "@/lib/utils";

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function TemplateDialog({
  template,
  onClose,
  onSaved,
}: {
  /** null: new template. */
  template: Template | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("Operational.reportei.templatesPage");
  const tm = useTranslations("Operational.reportei.reports");
  const [name, setName] = useState(template?.name ?? "");
  const [metrics, setMetrics] = useState<MetricKey[]>(template?.metrics ?? [...DEFAULT_OPTIONS.metrics]);
  const [chart, setChart] = useState(template?.chart ?? true);
  const [chartMetrics, setChartMetrics] = useState<DailyMetric[]>(template?.chartMetrics.length ? template.chartMetrics : [...DEFAULT_OPTIONS.chartMetrics]);
  const [compare, setCompare] = useState(template?.compare ?? true);
  const [intro, setIntro] = useState(template?.intro ?? "");
  const [saving, setSaving] = useState(false);

  const body = { name: name.trim(), metrics, chart, chartMetrics, compare, intro };
  const valid = body.name.length > 0 && body.name.length <= NAME_MAX && parseOptions(body) !== null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(template ? `/api/operational/reportei/templates/${template.id}` : "/api/operational/reportei/templates", {
        method: template ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
          <DialogTitle>{template ? t("editTitle") : t("newTitle")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t("nameLabel")}</span>
            <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
          </label>

          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">{t("metricsLabel")}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("metricsLabel")}>
              {METRICS.map((m) => (
                <button key={m} type="button" aria-pressed={metrics.includes(m)} onClick={() => setMetrics((cur) => toggle(cur, m))} className={chip(metrics.includes(m))}>
                  {tm(`metric_${m}`)}
                </button>
              ))}
            </div>
            {metrics.length === 0 && <p className="text-xs text-red-500">{t("metricsRequired")}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={chart} onChange={(e) => setChart(e.target.checked)} className="h-4 w-4 accent-primary" />
              {t("chartLabel")}
            </label>
            {chart && (
              <>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("chartMetricsLabel")}>
                  {DAILY_METRICS.map((m) => (
                    <button key={m} type="button" aria-pressed={chartMetrics.includes(m)} onClick={() => setChartMetrics((cur) => toggle(cur, m))} className={chip(chartMetrics.includes(m))}>
                      {tm(`metric_${m}`)}
                    </button>
                  ))}
                </div>
                {chartMetrics.length === 0 && <p className="text-xs text-red-500">{t("chartMetricsRequired")}</p>}
              </>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t("compareLabel")}
          </label>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium text-foreground">{t("introLabel")}</span>
            <Textarea value={intro} maxLength={INTRO_MAX} rows={3} onChange={(e) => setIntro(e.target.value)} placeholder={t("introPlaceholder")} />
            <span className="block text-right text-[11px] text-muted-foreground">
              {intro.length}/{INTRO_MAX}
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={saving || !valid} onClick={save}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
