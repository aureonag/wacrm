"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, Gift, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Campaign, DiscountType, Frequency, Reward, RewardType } from "@/lib/affiliates/campaigns";
import { useWorkspace } from "./workspace";

interface Draft {
  name: string;
  description: string;
  policy: string;
  discount_type: DiscountType;
  discount: string;
  frequency: Frequency | "";
  start_date: string;
  end_date: string;
  rewards: Reward[];
}

interface RewardDraft {
  month: string;
  type: RewardType | "";
  value: string;
  description: string;
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

function initialDraft(c: Campaign | null): Draft {
  const start = c?.start_date ?? today();
  return {
    name: c?.name ?? "",
    description: c?.description ?? "",
    policy: c?.policy ?? "",
    discount_type: c?.discount_type ?? "PERCENTAGE",
    discount: c ? String(Number(c.discount)) : "",
    frequency: c?.frequency ?? "",
    start_date: start,
    end_date: c?.end_date ?? start,
    rewards: c?.rewards ?? [],
  };
}

function formatMonth(m: string): string {
  return m.split("-").reverse().join("/");
}

export function CampaignEditor({ campaign }: { clientId?: string; campaign: Campaign | null }) {
  const { apiBase, pageBase } = useWorkspace();
  const t = useTranslations("Operational.affiliates");
  const router = useRouter();
  const edit = campaign !== null;
  const backHref = `${pageBase}/campanhas`;

  const [draft, setDraft] = useState<Draft>(() => initialDraft(campaign));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [reward, setReward] = useState<RewardDraft | null>(null);
  const [rewardError, setRewardError] = useState("");

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function cancel() {
    if (saving) return;
    if (dirty) setDiscarding(true);
    else router.push(backHref);
  }

  const startMonth = draft.start_date.slice(0, 7);

  function openReward(r?: Reward) {
    setRewardError("");
    setReward(
      r
        ? { month: r.month, type: r.type, value: r.value === null ? "" : String(r.value), description: r.description }
        : { month: startMonth, type: "", value: "", description: "" },
    );
  }

  function commitReward() {
    if (!reward) return;
    if (!reward.type) return setRewardError(t("editor.rewardErrorType"));
    if (reward.type === "OTHER") {
      if (!reward.description.trim()) return setRewardError(t("editor.rewardErrorDescription"));
    } else {
      const v = Number(reward.value);
      if (!Number.isFinite(v) || v <= 0 || v > 100) return setRewardError(t("editor.rewardErrorValue"));
    }
    if (draft.frequency === "RECURRENT" && reward.month < startMonth) return setRewardError(t("editor.rewardErrorMonth"));
    const item: Reward = {
      month: draft.frequency === "PERIODIC" ? startMonth : reward.month,
      type: reward.type,
      value: reward.type === "OTHER" ? null : Number(reward.value),
      description: reward.description.trim(),
    };
    update(
      "rewards",
      [...draft.rewards.filter((r) => r.month !== item.month), item].sort((a, b) => a.month.localeCompare(b.month)),
    );
    setReward(null);
    setRewardError("");
  }

  async function save() {
    if (reward) return setRewardError(t("editor.rewardPending"));
    setSaving(true);
    const body = {
      ...draft,
      discount: Number(draft.discount),
      end_date: draft.frequency === "PERIODIC" ? draft.end_date : null,
      ...(edit ? { revision: campaign.revision } : {}),
    };
    const url = edit
      ? `${apiBase}/campaigns/${campaign.id}`
      : `${apiBase}/campaigns`;
    const res = await fetch(url, {
      method: edit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      toast.error(res.status === 400 || res.status === 409 ? (data?.error ?? t("saveError")) : t("saveError"));
      return;
    }
    setDirty(false);
    toast.success(edit ? t("campaigns.updated") : t("campaigns.created"));
    router.push(backHref);
  }

  const typeLabel = (type: RewardType) =>
    type === "PIX" ? t("editor.typePix") : type === "GIFTBACK" ? t("editor.typeGiftback") : t("editor.typeOther");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label={t("editor.back")} onClick={cancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold text-foreground">{edit ? t("editor.editTitle") : t("editor.createTitle")}</h2>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cancel} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !draft.name.trim() || !draft.frequency}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t("save")}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-medium text-foreground">{t("editor.warningTitle")}</p>
              <p className="mt-0.5 text-muted-foreground">{t("editor.warningBody")}</p>
            </div>
          </div>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">{t("editor.infoTitle")}</h3>
            <div className="space-y-1.5">
              <Label htmlFor="c-name">{t("editor.fieldName")}</Label>
              <Input id="c-name" value={draft.name} maxLength={200} onChange={(e) => update("name", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-desc">{t("editor.fieldDescription")}</Label>
              <Textarea id="c-desc" rows={3} value={draft.description} maxLength={20000} onChange={(e) => update("description", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="c-policy">{t("editor.fieldPolicy")}</Label>
              <Textarea id="c-policy" rows={5} value={draft.policy} maxLength={20000} onChange={(e) => update("policy", e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("editor.policyHint")}</p>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground">{t("editor.discountTitle")}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="c-dtype">{t("editor.fieldDiscountType")}</Label>
                <Select
                  value={draft.discount_type}
                  disabled={edit}
                  onValueChange={(v) => v && update("discount_type", v as DiscountType)}
                >
                  <SelectTrigger id="c-dtype" className="w-full">
                    <SelectValue>
                      {draft.discount_type === "PERCENTAGE" ? t("editor.discountPercentage") : t("editor.discountCurrency")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">{t("editor.discountPercentage")}</SelectItem>
                    <SelectItem value="CURRENCY">{t("editor.discountCurrency")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="c-discount">
                  {t("editor.fieldDiscount", { unit: draft.discount_type === "PERCENTAGE" ? "%" : "R$" })}
                </Label>
                <Input
                  id="c-discount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={draft.discount_type === "PERCENTAGE" ? 100 : 1000000}
                  value={draft.discount}
                  onChange={(e) => update("discount", e.target.value)}
                />
              </div>
            </div>
            {edit && <p className="text-xs text-muted-foreground">{t("editor.discountTypeLocked")}</p>}
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t("editor.rewardsTitle")}</h3>
              <Button
                variant="outline"
                size="sm"
                disabled={!draft.frequency || (draft.frequency === "PERIODIC" && draft.rewards.length > 0)}
                onClick={() => openReward()}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("editor.addReward")}
              </Button>
            </div>

            {draft.rewards.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                <Gift className="h-4 w-4" />
                {draft.frequency ? t("editor.noRewards") : t("editor.pickFrequencyFirst")}
              </div>
            ) : (
              <ul className="space-y-2">
                {draft.rewards.map((r) => (
                  <li key={r.month} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="min-w-0 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {typeLabel(r.type)}
                        </span>
                        {draft.frequency === "RECURRENT" && (
                          <span className="text-xs text-muted-foreground">{formatMonth(r.month)}</span>
                        )}
                      </div>
                      <p className="mt-1 font-medium text-foreground">
                        {r.type === "OTHER" ? r.description : t("editor.rewardOnVolume", { value: r.value ?? 0 })}
                      </p>
                      {r.type !== "OTHER" && r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openReward(r)}>
                        {t("clients.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("editor.removeReward")}
                        onClick={() => update("rewards", draft.rewards.filter((x) => x.month !== r.month))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {draft.frequency === "RECURRENT" && <p className="text-xs text-muted-foreground">{t("editor.monthlyRanking")}</p>}

            {reward && (
              <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <h4 className="text-sm font-semibold text-foreground">
                  {draft.rewards.some((r) => r.month === reward.month) ? t("editor.editReward") : t("editor.addReward")}
                </h4>
                {rewardError && (
                  <p role="alert" className="text-sm text-destructive">
                    {rewardError}
                  </p>
                )}
                {draft.frequency === "RECURRENT" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="r-month">{t("editor.fieldMonth")}</Label>
                    <Input
                      id="r-month"
                      type="month"
                      min={startMonth}
                      value={reward.month}
                      onChange={(e) => setReward({ ...reward, month: e.target.value })}
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="r-type">{t("editor.fieldRewardType")}</Label>
                  <Select
                    value={reward.type || null}
                    onValueChange={(v) => v && setReward({ ...reward, type: v as RewardType })}
                  >
                    <SelectTrigger id="r-type" className="w-full">
                      <SelectValue>{reward.type ? typeLabel(reward.type) : t("editor.select")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GIFTBACK">{t("editor.typeGiftback")}</SelectItem>
                      <SelectItem value="PIX">{t("editor.typePix")}</SelectItem>
                      <SelectItem value="OTHER">{t("editor.typeOther")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(reward.type === "PIX" || reward.type === "GIFTBACK") && (
                  <div className="space-y-1.5">
                    <Label htmlFor="r-value">{t("editor.fieldRewardValue")}</Label>
                    <Input
                      id="r-value"
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={reward.value}
                      onChange={(e) => setReward({ ...reward, value: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">{t("editor.rewardOnVolumeHint")}</p>
                  </div>
                )}
                {reward.type && (
                  <div className="space-y-1.5">
                    <Label htmlFor="r-desc">
                      {reward.type === "OTHER" ? t("editor.fieldRewardOther") : t("editor.fieldRewardExtra")}
                    </Label>
                    <Textarea
                      id="r-desc"
                      rows={2}
                      maxLength={2000}
                      value={reward.description}
                      onChange={(e) => setReward({ ...reward, description: e.target.value })}
                    />
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setReward(null);
                      setRewardError("");
                    }}
                  >
                    {t("editor.cancelReward")}
                  </Button>
                  <Button size="sm" onClick={commitReward}>
                    {t("editor.confirmReward")}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside className="h-fit space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">{t("editor.periodTitle")}</h3>
          <div className="space-y-1.5">
            <Label htmlFor="c-freq">{t("editor.fieldFrequency")}</Label>
            <Select
              value={draft.frequency || null}
              disabled={edit}
              onValueChange={(v) => {
                if (!v) return;
                setDirty(true);
                setReward(null);
                setDraft((d) => ({ ...d, frequency: v as Frequency, rewards: [] }));
              }}
            >
              <SelectTrigger id="c-freq" className="w-full">
                <SelectValue>
                  {draft.frequency === "RECURRENT"
                    ? t("editor.recurrent")
                    : draft.frequency === "PERIODIC"
                      ? t("editor.periodic")
                      : t("editor.select")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RECURRENT">{t("editor.recurrent")}</SelectItem>
                <SelectItem value="PERIODIC">{t("editor.periodic")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.frequency && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="c-start">{t("editor.fieldStart")}</Label>
                <Input
                  id="c-start"
                  type="date"
                  disabled={edit}
                  value={draft.start_date}
                  onChange={(e) => update("start_date", e.target.value)}
                />
              </div>
              {draft.frequency === "PERIODIC" && (
                <div className="space-y-1.5">
                  <Label htmlFor="c-end">{t("editor.fieldEnd")}</Label>
                  <Input
                    id="c-end"
                    type="date"
                    disabled={edit}
                    min={draft.start_date}
                    value={draft.end_date}
                    onChange={(e) => update("end_date", e.target.value)}
                  />
                </div>
              )}
              {draft.frequency === "RECURRENT" && <p className="text-xs text-muted-foreground">{t("editor.recurrentHint")}</p>}
            </>
          )}
          {edit && <p className="text-xs text-muted-foreground">{t("editor.periodLocked")}</p>}
        </aside>
      </div>

      <Dialog open={discarding} onOpenChange={setDiscarding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editor.discardTitle")}</DialogTitle>
            <DialogDescription>{t("editor.discardHint")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscarding(false)}>
              {t("editor.keepEditing")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDirty(false);
                router.push(backHref);
              }}
            >
              {t("editor.discard")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
