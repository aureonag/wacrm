"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { Deal } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { loadDealGoal, upsertDealGoal } from "@/lib/pipelines/queries";
import { getPeriodRange } from "@/lib/dashboard/period";
import { cn } from "@/lib/utils";
import { Pencil, Target } from "lucide-react";

interface GoalVsActualCardProps {
  /** Unfiltered by the top period picker — the goal is always "this
   *  calendar month", per the spec. */
  deals: Deal[];
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function GoalVsActualCard({ deals }: GoalVsActualCardProps) {
  const t = useTranslations("Dashboard.goal");
  const { accountId, user, defaultCurrency } = useAuth();
  const canEdit = useCan("send-messages");
  const supabase = createClient();

  const [goalAmount, setGoalAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [draftAmount, setDraftAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const periodMonth = currentMonthKey();

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const goal = await loadDealGoal(supabase, accountId, periodMonth);
      if (!cancelled) {
        setGoalAmount(goal?.amount ?? 0);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, periodMonth]);

  const actual = useMemo(() => {
    const range = getPeriodRange("month");
    return deals
      .filter((d) => d.status === "won" && d.closed_at && new Date(d.closed_at) >= range.start && new Date(d.closed_at) <= range.end)
      .reduce((sum, d) => sum + (d.value ?? 0), 0);
  }, [deals]);

  const attainment = goalAmount && goalAmount > 0 ? (actual / goalAmount) * 100 : 0;

  function openEdit() {
    setDraftAmount(goalAmount ? String(goalAmount) : "");
    setEditOpen(true);
  }

  async function handleSave() {
    if (!accountId || !user?.id) return;
    const amount = Number(draftAmount.replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    setSaving(true);
    const saved = await upsertDealGoal(supabase, accountId, periodMonth, amount, user.id);
    setSaving(false);
    if (!saved) {
      toast.error(t("saveError"));
      return;
    }
    setGoalAmount(saved.amount);
    setEditOpen(false);
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Target className="h-4 w-4 text-primary" />
            {t("title")}
          </CardTitle>
          <CardDescription className="text-xs">{t("description")}</CardDescription>
        </div>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            onClick={openEdit}
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            aria-label={t("edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-16 animate-pulse rounded bg-muted/50" />
        ) : !goalAmount ? (
          <p className="text-sm text-muted-foreground">{t("noGoal")}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <p className="text-lg font-semibold text-foreground">{formatCurrency(actual, defaultCurrency)}</p>
              <p className="text-xs text-muted-foreground">
                {t("ofGoal", { goal: formatCurrency(goalAmount, defaultCurrency) })}
              </p>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  attainment >= 100 ? "bg-emerald-500" : "bg-primary",
                )}
                style={{ width: `${Math.min(attainment, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {attainment >= 100
                ? t("attainmentOver", { percent: attainment.toFixed(0) })
                : t("attainmentUnder", {
                    percent: attainment.toFixed(0),
                    remaining: formatCurrency(Math.max(goalAmount - actual, 0), defaultCurrency),
                  })}
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-muted-foreground">{t("amountLabel")}</Label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={draftAmount}
              onChange={(e) => setDraftAmount(e.target.value)}
              placeholder="0"
              className="bg-muted text-foreground"
            />
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              className="border-border bg-transparent text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
