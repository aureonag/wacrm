"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Deal, DealTag, PipelineStage } from "@/types";
import { Calendar, Check, Clock, Plus, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { sumLineItems } from "@/lib/pipelines/queries";
import { frenteLabelKey } from "@/lib/deals/frente";
import { daysSinceUpdate, isStaleDeal } from "@/lib/deals/deal-rot";
import { DEAL_TAG_COLORS } from "@/lib/deals/tag-colors";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  isOverlay?: boolean;
  /** Whether THIS card's inline tag editor is the one currently open —
   *  only one editor may be open across the whole board at a time. */
  tagEditorOpen?: boolean;
  onToggleTagEditor?: (dealId: string | null) => void;
  onTagsChanged?: (dealId: string, tags: DealTag[]) => void;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  isOverlay,
  tagEditorOpen,
  onToggleTagEditor,
  onTagsChanged,
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const router = useRouter();
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan("send-messages");

  const [newTagText, setNewTagText] = useState("");
  const [newTagColor, setNewTagColor] = useState<string>(DEAL_TAG_COLORS[0].value);
  const [savingTag, setSavingTag] = useState(false);

  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  const lineItems = deal.lineItems ?? [];
  const hasLineItems = lineItems.length > 0;
  const mensalSum = hasLineItems ? sumLineItems(lineItems, "mensal") : 0;
  const pontualSum = hasLineItems ? sumLineItems(lineItems, "pontual") : 0;

  const frenteKey = frenteLabelKey(deal.frente_leadgen, deal.frente_avr);
  const frenteLabel =
    frenteKey === "both" ? t("frenteBoth") : frenteKey === "avr" ? t("frenteAvr") : frenteKey === "leadgen" ? t("frenteLeadgen") : null;
  const stale = !isOverlay && isStaleDeal(deal);

  function goToDetail() {
    if (isOverlay) return;
    router.push(`/pipelines/deals/${deal.id}`);
  }

  function openTagEditor(e: React.MouseEvent) {
    e.stopPropagation();
    setNewTagText("");
    setNewTagColor(DEAL_TAG_COLORS[0].value);
    onToggleTagEditor?.(deal.id);
  }

  function closeTagEditor(e?: React.MouseEvent) {
    e?.stopPropagation();
    onToggleTagEditor?.(null);
  }

  async function handleAddTag(e: React.MouseEvent) {
    e.stopPropagation();
    if (!newTagText.trim() || !accountId) return;
    setSavingTag(true);
    const { data, error } = await supabase
      .from("deal_tags")
      .insert({
        deal_id: deal.id,
        account_id: accountId,
        label: newTagText.trim(),
        color: newTagColor,
      })
      .select()
      .single();
    setSavingTag(false);
    if (error || !data) {
      toast.error(t("toastFailed"));
      return;
    }
    onTagsChanged?.(deal.id, [...(deal.dealTags ?? []), data as DealTag]);
    onToggleTagEditor?.(null);
  }

  async function handleRemoveTag(e: React.MouseEvent, tagId: string) {
    e.stopPropagation();
    const { error } = await supabase.from("deal_tags").delete().eq("id", tagId);
    if (error) {
      toast.error(t("toastFailed"));
      return;
    }
    onTagsChanged?.(deal.id, (deal.dealTags ?? []).filter((t) => t.id !== tagId));
  }

  return (
    <div
      role={isOverlay ? undefined : "button"}
      tabIndex={isOverlay ? undefined : 0}
      onClick={goToDetail}
      onKeyDown={(e) => {
        if (isOverlay) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goToDetail();
        }
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      {deal.segment && (
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground/70">{deal.segment}</p>
      )}

      {stale && (
        <span className="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
          <Clock className="h-2.5 w-2.5" />
          {t("staleDays", { days: daysSinceUpdate(deal) })}
        </span>
      )}

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      <div className="mt-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          {hasLineItems ? (
            mensalSum > 0 ? (
              <>
                <p className="text-sm font-bold text-primary">
                  {t("perMonth", { value: formatCurrency(mensalSum, deal.currency) })}
                </p>
                {pontualSum > 0 && (
                  <p className="text-[10.5px] text-muted-foreground/70">
                    {t("pontualExtra", { value: formatCurrency(pontualSum, deal.currency) })}
                  </p>
                )}
              </>
            ) : (
              // No mensal entries — showing "R$0/mês" as the headline would
              // look broken for a pontual-only deal, so lead with the
              // pontual total plain (no "/mês" suffix) instead.
              <p className="text-sm font-bold text-primary">
                {formatCurrency(pontualSum, deal.currency)}
              </p>
            )
          ) : (
            <p className="text-sm font-bold text-primary">
              {formatCurrency(deal.value, deal.currency)}
            </p>
          )}
        </div>
        {frenteLabel && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              frenteKey === "leadgen"
                ? "bg-secondary text-secondary-foreground"
                : "bg-primary/15 text-primary"
            }`}
          >
            {frenteLabel}
          </span>
        )}
      </div>

      {deal.expected_close_date && (
        <div className="mt-1 flex items-center justify-end">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        </div>
      )}

      {/* Etiquetas do negócio */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(deal.dealTags ?? []).map((tag) => (
          <span
            key={tag.id}
            className="group/tag inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
            style={{
              backgroundColor: `${tag.color}20`,
              color: tag.color,
              border: `1px solid ${tag.color}40`,
            }}
          >
            {tag.label}
            {canEdit && (
              <button
                type="button"
                onClick={(e) => handleRemoveTag(e, tag.id)}
                aria-label={t("removeTagAria", { label: tag.label })}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </span>
        ))}
        {canEdit && !isOverlay && !tagEditorOpen && (
          <button
            type="button"
            onClick={openTagEditor}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[10.5px] text-muted-foreground hover:border-border hover:text-foreground"
          >
            <Plus className="h-2.5 w-2.5" />
            {t("addTag")}
          </button>
        )}
      </div>

      {tagEditorOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-2 space-y-2 rounded-lg border border-border bg-card p-2"
        >
          <input
            autoFocus
            type="text"
            value={newTagText}
            onChange={(e) => setNewTagText(e.target.value)}
            placeholder={t("tagPlaceholder")}
            className="h-7 w-full rounded-md border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1">
              {DEAL_TAG_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewTagColor(c.value);
                  }}
                  aria-label={c.name}
                  className={`h-4 w-4 rounded-full transition-transform hover:scale-110 ${
                    newTagColor === c.value ? "outline outline-2 outline-offset-1 outline-foreground" : ""
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={closeTagEditor}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={handleAddTag}
                disabled={!newTagText.trim() || savingTag}
                className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("addTagConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </div>
  );
}
