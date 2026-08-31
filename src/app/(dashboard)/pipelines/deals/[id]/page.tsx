"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  loadDealById,
  loadDealActivities,
  loadDealComments,
  loadDealNextSteps,
  syncDealValueFromLineItems,
} from "@/lib/pipelines/queries";
import type {
  CustomField,
  Deal,
  DealActivity,
  DealComment,
  DealCustomValue,
  DealLineItem,
  DealLineItemType,
  DealNextStep,
  DealStatus,
  DealTag,
  PipelineStage,
  Profile,
  ServiceCatalogItem,
} from "@/types";
import { formatCurrency } from "@/lib/currency";
import { frenteLabelKey } from "@/lib/deals/frente";
import { DEAL_TAG_COLORS } from "@/lib/deals/tag-colors";
import { relativeTime } from "@/lib/dashboard/relative-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  X,
  Plus,
  Trash2,
  Loader2,
  CalendarClock,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import { formatStepDueDate } from "@/lib/deals/next-step-date";

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export default function DealDetailPage() {
  const params = useParams<{ id: string }>();
  const dealId = params.id;
  const router = useRouter();
  const supabase = createClient();
  const { user, accountId } = useAuth();
  const canEdit = useCan("send-messages");
  const t = useTranslations("Pipelines.detail");
  const locale = useLocale();
  const tActivityFeed = useTranslations("Dashboard.activityFeed");
  const tActivity = useTranslations("Pipelines.activity");
  const tCard = useTranslations("Pipelines.card");
  const tCreate = useTranslations("Pipelines.createModal");

  const [deal, setDeal] = useState<Deal | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [comments, setComments] = useState<DealComment[]>([]);
  const [nextSteps, setNextSteps] = useState<DealNextStep[]>([]);
  const [dealFields, setDealFields] = useState<CustomField[]>([]);
  const [dealFieldValues, setDealFieldValues] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const d = await loadDealById(supabase, dealId);
      if (cancelled) return;
      setDeal(d);
      if (d) {
        const [stageRows, profileRows, activityRows, commentRows, stepRows, fieldRows, valueRows, catalogRows] =
          await Promise.all([
            supabase.from("pipeline_stages").select("*").eq("pipeline_id", d.pipeline_id).order("position"),
            supabase.from("profiles").select("*").order("full_name"),
            loadDealActivities(supabase, dealId),
            loadDealComments(supabase, dealId),
            loadDealNextSteps(supabase, dealId),
            supabase.from("custom_fields").select("*").eq("entity_type", "deal").order("field_name"),
            supabase.from("deal_custom_values").select("*").eq("deal_id", dealId),
            supabase.from("service_catalog").select("*").order("name"),
          ]);
        if (cancelled) return;
        setStages((stageRows.data ?? []) as PipelineStage[]);
        setProfiles((profileRows.data ?? []) as Profile[]);
        setActivities(activityRows);
        setComments(commentRows);
        setNextSteps(stepRows);
        setDealFields((fieldRows.data ?? []) as CustomField[]);
        const valueMap: Record<string, string> = {};
        for (const v of (valueRows.data ?? []) as DealCustomValue[]) {
          valueMap[v.custom_field_id] = v.value ?? "";
        }
        setDealFieldValues(valueMap);
        setCatalog((catalogRows.data ?? []) as ServiceCatalogItem[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, dealId]);

  async function updateDealField(patch: Partial<Deal>) {
    if (!deal) return;
    setDeal({ ...deal, ...patch });
    const { error } = await supabase.from("deals").update(patch).eq("id", deal.id);
    if (error) toast.error(t("toastFailedSave"));
  }

  // Mirrors the activity log entry the Kanban's drag-and-drop writes, so a
  // stage change made from either surface leaves a trail — worded
  // differently since this one isn't a drag.
  async function handleStageChange(newStageId: string) {
    if (!deal || newStageId === deal.stage_id) return;
    const newStage = stages.find((s) => s.id === newStageId);
    await updateDealField({ stage_id: newStageId });
    if (!newStage || !accountId) return;
    const { data } = await supabase
      .from("deal_activities")
      .insert({
        deal_id: deal.id,
        account_id: accountId,
        user_id: user?.id ?? null,
        type: "stage_changed",
        title: tActivity("movedTo", { stage: newStage.name }),
        detail: tActivity("movedDetailManual"),
      })
      .select()
      .single();
    if (data) setActivities((prev) => [data as DealActivity, ...prev]);
  }

  async function handleStatusChange(status: DealStatus, lostReason?: string | null) {
    if (!deal) return;
    setStatusAction(status);
    const patch: Partial<Deal> = { status };
    // Reopening clears a stale reason; marking lost sets the one just
    // picked. Won doesn't touch the field either way.
    if (status === "open") patch.lost_reason = null;
    if (status === "lost") patch.lost_reason = lostReason ?? null;
    const { error } = await supabase.from("deals").update(patch).eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    setDeal({ ...deal, ...patch });
    toast.success(
      status === "won" ? t("toastMarkedWon") : status === "lost" ? t("toastMarkedLost") : t("toastReopened"),
    );
  }

  // ---- Delete deal (mistaken creation, test data, etc.) ----
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDeal, setDeletingDeal] = useState(false);

  async function handleDeleteDeal() {
    if (!deal) return;
    setDeletingDeal(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeletingDeal(false);
    if (error) {
      toast.error(t("toastFailedDeleteDeal"));
      return;
    }
    toast.success(t("toastDealDeleted"));
    router.push("/pipelines");
  }

  async function handleSaveDealField(fieldId: string, value: string) {
    if (!deal) return;
    setDealFieldValues((prev) => ({ ...prev, [fieldId]: value }));
    const { error } = await supabase
      .from("deal_custom_values")
      .upsert({ deal_id: deal.id, custom_field_id: fieldId, value }, { onConflict: "deal_id,custom_field_id" });
    if (error) toast.error(t("toastFailedSave"));
  }

  // ---- Lost reason (asked before actually marking a deal Lost) ----
  const LOST_REASON_KEYS = ["price", "competitor", "budget", "noResponse", "other"] as const;
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);
  const [selectedLostReason, setSelectedLostReason] = useState<(typeof LOST_REASON_KEYS)[number]>("price");
  const [lostReasonOtherText, setLostReasonOtherText] = useState("");

  function openLostReasonDialog() {
    setSelectedLostReason("price");
    setLostReasonOtherText("");
    setLostReasonDialogOpen(true);
  }

  async function confirmMarkLost() {
    const reason = selectedLostReason === "other" ? lostReasonOtherText.trim() : selectedLostReason;
    if (!reason) return;
    await handleStatusChange("lost", reason);
    setLostReasonDialogOpen(false);
  }

  /** `lost_reason` stores one of the fixed keys verbatim, or free text
   *  when the picker's "Outro" option was used — translate the former,
   *  show the latter as-is. */
  function formatLostReason(reason: string): string {
    return (LOST_REASON_KEYS as readonly string[]).includes(reason)
      ? t(`lostReason_${reason}` as Parameters<typeof t>[0])
      : reason;
  }

  // ---- Tags (mirrors the Kanban card's inline editor / same data) ----
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [newTagText, setNewTagText] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(DEAL_TAG_COLORS[0].value);

  async function handleAddTag() {
    if (!deal || !accountId || !newTagText.trim()) return;
    const { data } = await supabase
      .from("deal_tags")
      .insert({ deal_id: deal.id, account_id: accountId, label: newTagText.trim(), color: newTagColor })
      .select()
      .single();
    if (data) {
      setDeal({ ...deal, dealTags: [...(deal.dealTags ?? []), data as DealTag] });
      setTagEditorOpen(false);
      setNewTagText("");
    }
  }

  async function handleRemoveTag(tagId: string) {
    if (!deal) return;
    const { error } = await supabase.from("deal_tags").delete().eq("id", tagId);
    if (!error) setDeal({ ...deal, dealTags: (deal.dealTags ?? []).filter((tg) => tg.id !== tagId) });
  }

  // ---- Line items ----
  const [addingLineItem, setAddingLineItem] = useState(false);
  const [lineItemType, setLineItemType] = useState<DealLineItemType>("mensal");
  const [lineItemLabel, setLineItemLabel] = useState("");
  const [lineItemValue, setLineItemValue] = useState("");

  async function handleAddLineItem() {
    if (!deal || !accountId) return;
    const value = parseFloat(lineItemValue) || 0;
    const { data, error } = await supabase
      .from("deal_line_items")
      .insert({ deal_id: deal.id, account_id: accountId, type: lineItemType, label: lineItemLabel.trim() || null, value })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedSave"));
      return;
    }
    const nextItems = [...(deal.lineItems ?? []), data as DealLineItem];
    const newValue = await syncDealValueFromLineItems(supabase, deal.id, nextItems);
    setDeal({ ...deal, lineItems: nextItems, value: newValue });
    setAddingLineItem(false);
    setLineItemLabel("");
    setLineItemValue("");
  }

  async function handleDeleteLineItem(id: string) {
    if (!deal) return;
    const { error } = await supabase.from("deal_line_items").delete().eq("id", id);
    if (error) {
      toast.error(t("toastFailedSave"));
      return;
    }
    const nextItems = (deal.lineItems ?? []).filter((li) => li.id !== id);
    const newValue = await syncDealValueFromLineItems(supabase, deal.id, nextItems);
    setDeal({ ...deal, lineItems: nextItems, value: newValue });
  }

  // ---- Comments ----
  const [commentDraft, setCommentDraft] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  async function handleAddComment() {
    if (!deal || !accountId || !user || !commentDraft.trim()) return;
    setPostingComment(true);
    const { data, error } = await supabase
      .from("deal_comments")
      .insert({ deal_id: deal.id, account_id: accountId, user_id: user.id, body: commentDraft.trim() })
      .select()
      .single();
    setPostingComment(false);
    if (error || !data) {
      toast.error(t("toastFailedSave"));
      return;
    }
    setComments([{ ...(data as DealComment) }, ...comments]);
    setCommentDraft("");
  }

  // ---- Next steps ----
  const [nextStepDraft, setNextStepDraft] = useState("");
  const [nextStepDueDraft, setNextStepDueDraft] = useState("");

  async function handleAddNextStep() {
    if (!deal || !accountId || !nextStepDraft.trim()) return;
    const { data, error } = await supabase
      .from("deal_next_steps")
      .insert({
        deal_id: deal.id,
        account_id: accountId,
        title: nextStepDraft.trim(),
        due_date: nextStepDueDraft || null,
        position: nextSteps.length,
      })
      .select()
      .single();
    if (error || !data) {
      toast.error(t("toastFailedSave"));
      return;
    }
    setNextSteps([...nextSteps, data as DealNextStep]);
    setNextStepDraft("");
    setNextStepDueDraft("");
  }

  async function toggleNextStep(step: DealNextStep) {
    const done = !step.done;
    setNextSteps(nextSteps.map((s) => (s.id === step.id ? { ...s, done } : s)));
    const { error } = await supabase.from("deal_next_steps").update({ done }).eq("id", step.id);
    if (error) {
      toast.error(t("toastFailedSave"));
      setNextSteps(nextSteps.map((s) => (s.id === step.id ? { ...s, done: step.done } : s)));
    }
  }

  async function handleDeleteNextStep(id: string) {
    const previous = nextSteps;
    setNextSteps(nextSteps.filter((s) => s.id !== id));
    const { error } = await supabase.from("deal_next_steps").delete().eq("id", id);
    if (error) {
      toast.error(t("toastFailedSave"));
      setNextSteps(previous);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted/50" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">{t("notFound")}</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push("/pipelines")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t("back")}
        </Button>
      </div>
    );
  }

  const frenteKey = frenteLabelKey(deal.frente_leadgen, deal.frente_avr);
  const responsibleLabel = deal.assignee?.full_name || deal.assignee?.email || "";
  const avgTicket =
    (deal.lineItems ?? []).length > 0
      ? (deal.lineItems ?? []).reduce((s, li) => s + Number(li.value || 0), 0) / (deal.lineItems ?? []).length
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/pipelines"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-semibold text-foreground">{deal.title}</h1>
          {deal.status === "won" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
              <Check className="h-3 w-3" />
              {t("markAsWon")}
            </span>
          )}
          {deal.status === "lost" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
              <X className="h-3 w-3" />
              {t("markAsLost")}
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleStatusChange("won")}
              disabled={!!statusAction || deal.status === "won"}
              className="border-border"
            >
              {statusAction === "won" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("markAsWon")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openLostReasonDialog}
              disabled={!!statusAction || deal.status === "lost"}
              className="border-border"
            >
              {statusAction === "lost" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("markAsLost")}
            </Button>
            {deal.status && deal.status !== "open" && (
              <Button variant="ghost" size="sm" onClick={() => handleStatusChange("open")}>
                {t("reopenDeal")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
              title={t("deleteDeal")}
              className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
            <TabsTrigger value="activities">{t("tabActivities")}</TabsTrigger>
            <TabsTrigger value="deals">{t("tabDeals")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                {(deal.dealTags ?? []).map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: `${tag.color}20`, color: tag.color, border: `1px solid ${tag.color}40` }}
                  >
                    {tag.label}
                    {canEdit && (
                      <button type="button" onClick={() => handleRemoveTag(tag.id)} className="opacity-60 hover:opacity-100">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                ))}
                {canEdit && !tagEditorOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setNewTagText("");
                      setNewTagColor(DEAL_TAG_COLORS[0].value);
                      setTagEditorOpen(true);
                    }}
                    className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="h-2.5 w-2.5" />
                    {tCard("addTag")}
                  </button>
                )}
              </div>
              {tagEditorOpen && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
                  <input
                    autoFocus
                    value={newTagText}
                    onChange={(e) => setNewTagText(e.target.value)}
                    placeholder={tCard("tagPlaceholder")}
                    className="h-7 flex-1 min-w-[120px] rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                  />
                  <div className="flex gap-1">
                    {DEAL_TAG_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setNewTagColor(c.value)}
                        className={`h-4 w-4 rounded-full ${newTagColor === c.value ? "outline outline-2 outline-offset-1 outline-foreground" : ""}`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                  <Button size="sm" onClick={handleAddTag} disabled={!newTagText.trim()}>
                    {tCard("addTagConfirm")}
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("name")}</Label>
                  <Input
                    defaultValue={deal.title}
                    disabled={!canEdit}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== deal.title && updateDealField({ title: e.target.value.trim() })}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("responsible")}</Label>
                  <select
                    value={deal.assigned_to ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => updateDealField({ assigned_to: e.target.value || null })}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="">—</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                  </select>
                  {!profiles.some((p) => p.id === deal.assigned_to) && responsibleLabel && (
                    <p className="text-xs text-muted-foreground">{responsibleLabel}</p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("segment")}</Label>
                  <Input
                    defaultValue={deal.segment ?? ""}
                    disabled={!canEdit}
                    onBlur={(e) => updateDealField({ segment: e.target.value.trim() || null })}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("region")}</Label>
                  <Input
                    defaultValue={deal.region ?? ""}
                    disabled={!canEdit}
                    onBlur={(e) => updateDealField({ region: e.target.value.trim() || null })}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("stage")}</Label>
                  <select
                    value={deal.stage_id}
                    disabled={!canEdit}
                    onChange={(e) => handleStageChange(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("mediaInvestment")}</Label>
                  <Input
                    type="number"
                    defaultValue={deal.media_investment ?? ""}
                    disabled={!canEdit}
                    onBlur={(e) => updateDealField({ media_investment: e.target.value ? parseFloat(e.target.value) : null })}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label className="text-muted-foreground">{t("frente")}</Label>
                <div className="flex gap-2">
                  <Chip selected={!!deal.frente_leadgen} onClick={() => canEdit && updateDealField({ frente_leadgen: !deal.frente_leadgen })}>
                    {tCreate("frenteLeadgen")}
                  </Chip>
                  <Chip selected={!!deal.frente_avr} onClick={() => canEdit && updateDealField({ frente_avr: !deal.frente_avr })}>
                    {tCreate("frenteAvr")}
                  </Chip>
                  {frenteKey === null && <span className="self-center text-xs text-muted-foreground">—</span>}
                </div>
              </div>

              {deal.status === "lost" && deal.lost_reason && (
                <p className="text-xs text-muted-foreground">
                  {t("lostReasonLabel")}:{" "}
                  <span className="font-medium text-foreground">{formatLostReason(deal.lost_reason)}</span>
                </p>
              )}

              <div className="grid gap-1.5">
                <Label className="text-muted-foreground">{t("description")}</Label>
                <Textarea
                  defaultValue={deal.notes ?? ""}
                  disabled={!canEdit}
                  placeholder={t("descriptionPlaceholder")}
                  onBlur={(e) => updateDealField({ notes: e.target.value.trim() || undefined })}
                  className="min-h-[80px] border-border bg-muted text-foreground"
                />
              </div>

              {avgTicket > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("avgTicket")}: <span className="font-medium text-foreground">{formatCurrency(avgTicket, deal.currency)}</span>
                </p>
              )}
            </div>

            {dealFields.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">{t("dealFieldsTitle")}</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {dealFields.map((field) => (
                    <div key={field.id} className="grid gap-1.5">
                      <Label className="text-muted-foreground">{field.field_name}</Label>
                      <Input
                        value={dealFieldValues[field.id] ?? ""}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setDealFieldValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                        }
                        onBlur={(e) => handleSaveDealField(field.id, e.target.value.trim())}
                        className="border-border bg-muted text-foreground"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t("comments")}</h3>
              {canEdit && (
                <>
                  <div className="flex gap-2">
                    <Textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder={t("commentPlaceholder")}
                      className="min-h-[60px] flex-1 border-border bg-muted text-foreground"
                    />
                  </div>
                  <Button size="sm" onClick={handleAddComment} disabled={!commentDraft.trim() || postingComment}>
                    {t("addComment")}
                  </Button>
                </>
              )}
              <div className="space-y-2 pt-2">
                {comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("noComments")}</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="rounded-lg bg-muted/50 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {c.author?.full_name || c.author?.email || "—"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{relativeTime(c.created_at, tActivityFeed)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{c.body}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="activities" className="mt-4">
            <div className="rounded-xl border border-border bg-card">
              {activities.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">{t("noActivities")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activities.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div>
                        <p className="text-sm text-foreground">{a.title}</p>
                        {a.detail && <p className="text-xs text-muted-foreground">{a.detail}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {relativeTime(a.created_at, tActivityFeed)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>

          <TabsContent value="deals" className="mt-4 space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">{t("lineItemsTitle")}</h3>
                {canEdit && !addingLineItem && (
                  <Button size="sm" variant="outline" onClick={() => setAddingLineItem(true)}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("addLineItem")}
                  </Button>
                )}
              </div>

              {addingLineItem && (
                <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                  {catalog.length > 0 && (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const item = catalog.find((c) => c.id === e.target.value);
                        if (!item) return;
                        setLineItemType(item.type);
                        setLineItemLabel(item.name);
                        setLineItemValue(String(item.default_value));
                      }}
                      className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                    >
                      <option value="">{t("catalogPickPlaceholder")}</option>
                      {catalog.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <Chip selected={lineItemType === "mensal"} onClick={() => setLineItemType("mensal")}>
                      {tCreate("mensal")}
                    </Chip>
                    <Chip selected={lineItemType === "pontual"} onClick={() => setLineItemType("pontual")}>
                      {tCreate("pontual")}
                    </Chip>
                  </div>
                  <Input
                    value={lineItemLabel}
                    onChange={(e) => setLineItemLabel(e.target.value)}
                    placeholder={t("lineItemLabelPlaceholder")}
                    className="border-border bg-muted text-foreground"
                  />
                  <Input
                    type="number"
                    value={lineItemValue}
                    onChange={(e) => setLineItemValue(e.target.value)}
                    placeholder={t("lineItemValue")}
                    className="border-border bg-muted text-foreground"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setAddingLineItem(false)}>
                      {t("cancel")}
                    </Button>
                    <Button size="sm" onClick={handleAddLineItem} disabled={!lineItemValue}>
                      {t("save")}
                    </Button>
                  </div>
                </div>
              )}

              {(deal.lineItems ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noLineItems")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {(deal.lineItems ?? []).map((li) => (
                    <li key={li.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-foreground">
                          {formatCurrency(li.value, deal.currency)}{" "}
                          <span className="text-xs text-muted-foreground">
                            (
                            {li.type === "mensal"
                              ? tCreate("mensal")
                              : tCreate("pontual")}
                            )
                          </span>
                        </p>
                        {li.label && <p className="truncate text-xs text-muted-foreground">{li.label}</p>}
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLineItem(li.id)}
                          className="shrink-0 text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <Label className="text-muted-foreground">{t("proposalUrl")}</Label>
              <Input
                defaultValue={deal.proposal_url ?? ""}
                disabled={!canEdit}
                placeholder={t("proposalUrlPlaceholder")}
                onBlur={(e) => updateDealField({ proposal_url: e.target.value.trim() || null })}
                className="border-border bg-muted text-foreground"
              />
              {deal.proposal_url && (
                <a href={deal.proposal_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  {deal.proposal_url}
                </a>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* Sidebar — lg:mt-14 lines its first card up with the tabs'
            content (TabsList's h-8 + the gap-2/mt-4 above TabsContent),
            since the sidebar has no tab strip of its own to push it down. */}
        <div className="space-y-4 lg:mt-14">
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("mainContact")}</h3>
            {deal.contact ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">{deal.contact.name || "—"}</p>

                <div className="space-y-1.5 text-sm">
                  {deal.contact.phone && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t("phone")}</span>
                      <span className="text-foreground">{deal.contact.phone}</span>
                    </div>
                  )}
                  {deal.contact.email && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t("email")}</span>
                      <span className="truncate text-foreground">{deal.contact.email}</span>
                    </div>
                  )}
                  {deal.contact.website && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t("website")}</span>
                      <span className="truncate text-foreground">{deal.contact.website}</span>
                    </div>
                  )}
                  {deal.contact.instagram && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t("instagram")}</span>
                      <span className="truncate text-foreground">{deal.contact.instagram}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {deal.contact.phone && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-border"
                      onClick={() =>
                        window.open(`https://wa.me/${normalizePhone(deal.contact!.phone)}`, "_blank", "noopener,noreferrer")
                      }
                    >
                      {t("whatsappButton")}
                    </Button>
                  )}
                  {deal.contact.email && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 border-border"
                      onClick={() => window.open(`mailto:${deal.contact!.email}`, "_blank")}
                    >
                      {t("emailButton")}
                    </Button>
                  )}
                </div>
                {deal.contact.email && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full border-border"
                    onClick={() =>
                      window.open(
                        `https://calendar.google.com/calendar/render?action=TEMPLATE&add=${encodeURIComponent(
                          deal.contact!.email!,
                        )}&text=${encodeURIComponent(`Reunião com ${deal.contact!.name || deal.title}`)}`,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                    {t("scheduleMeet")}
                  </Button>
                )}

                <Link href="/contacts" className="inline-block text-xs text-primary hover:underline">
                  {t("viewContact")}
                </Link>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{t("noContact")}</p>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">{t("nextSteps")}</h3>
            {nextSteps.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("noNextSteps")}</p>
            ) : (
              <ul className="space-y-2">
                {nextSteps.map((s) => (
                  <li key={s.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={s.done}
                      onChange={() => toggleNextStep(s)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-border"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${s.done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                        {s.title}
                      </p>
                      {s.due_date && (
                        <p className="text-xs text-muted-foreground">{formatStepDueDate(s.due_date, locale, t)}</p>
                      )}
                    </div>
                    {canEdit && (
                      <button type="button" onClick={() => handleDeleteNextStep(s.id)} className="text-muted-foreground hover:text-red-400">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <Input
                  value={nextStepDraft}
                  onChange={(e) => setNextStepDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddNextStep()}
                  placeholder={t("nextStepPlaceholder")}
                  className="flex-1 border-border bg-muted text-foreground"
                />
                <input
                  type="date"
                  value={nextStepDueDraft}
                  onChange={(e) => setNextStepDueDraft(e.target.value)}
                  className="w-[130px] rounded-lg border border-border bg-muted px-2 text-sm text-foreground outline-none focus:border-primary"
                />
                <Button size="sm" onClick={handleAddNextStep} disabled={!nextStepDraft.trim()}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={lostReasonDialogOpen} onOpenChange={setLostReasonDialogOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("lostReasonTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap gap-2">
              {LOST_REASON_KEYS.map((key) => (
                <Chip key={key} selected={selectedLostReason === key} onClick={() => setSelectedLostReason(key)}>
                  {t(`lostReason_${key}` as Parameters<typeof t>[0])}
                </Chip>
              ))}
            </div>
            {selectedLostReason === "other" && (
              <Input
                autoFocus
                value={lostReasonOtherText}
                onChange={(e) => setLostReasonOtherText(e.target.value)}
                placeholder={t("lostReasonOtherPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            )}
          </div>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setLostReasonDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={confirmMarkLost}
              disabled={selectedLostReason === "other" && !lostReasonOtherText.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t("markAsLost")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border text-popover-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {t("deleteDealDialogTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t.rich("deleteDealDialogDesc", {
              title: deal.title,
              bold: (chunks: React.ReactNode) => <strong className="text-foreground">{chunks}</strong>,
            })}
          </p>
          <DialogFooter className="bg-popover/50 border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
              disabled={deletingDeal}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleDeleteDeal}
              disabled={deletingDeal}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deletingDeal ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("deletingDeal")}
                </>
              ) : (
                t("deleteDealBtn")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
