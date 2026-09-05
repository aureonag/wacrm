"use client";

// InboxKanbanView — Inbox → visão Kanban (Fase 4 do plano de WhatsApp
// pessoal). Mostra as conversas já vinculadas a um negócio (Fase 3),
// agrupadas pela etapa do pipeline selecionado. Arrastar um card entre
// colunas chama o MESMO update que o Pipeline normal já faz
// (src/app/(dashboard)/pipelines/page.tsx, handleDealMoved) — não é um
// motor de sincronização novo, é a mesma escrita compartilhada em
// `deals.stage_id`, então o card aparece na etapa nova em qualquer uma
// das duas telas na próxima vez que carregarem.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  closestCorners,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadPipelines, loadPipelineStages } from "@/lib/pipelines/queries";
import { formatCurrency } from "@/lib/currency";
import type { Conversation, Deal, Pipeline, PipelineStage } from "@/types";

interface KanbanDeal extends Deal {
  conversation?: Conversation | null;
}

export function InboxKanbanView({
  onSelectConversation,
}: {
  onSelectConversation: (conversationId: string) => void;
}) {
  const t = useTranslations("Inbox.kanban");
  const tActivity = useTranslations("Pipelines.activity");
  const { accountId, defaultCurrency } = useAuth();
  const supabase = createClient();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<KanbanDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await loadPipelines(supabase);
      if (cancelled) return;
      setPipelines(rows);
      setPipelineId((prev) => prev || rows[0]?.id || "");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadStagesAndDeals = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    const [stageRows, dealsRes] = await Promise.all([
      loadPipelineStages(supabase, pipelineId),
      supabase
        .from("deals")
        .select("*, contact:contacts(*), conversation:conversations(*)")
        .eq("pipeline_id", pipelineId)
        .not("conversation_id", "is", null)
        .order("created_at", { ascending: false }),
    ]);
    setStages(stageRows);
    setDeals((dealsRes.data ?? []) as KanbanDeal[]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId]);

  useEffect(() => {
    loadStagesAndDeals();
  }, [loadStagesAndDeals]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, KanbanDeal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeDeal = activeDealId ? deals.find((d) => d.id === activeDealId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const targetStageId = String(over.id);

    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === targetStageId) return;
    if (!sortedStages.some((s) => s.id === targetStageId)) return;

    // Same write the Pipeline board's handleDealMoved does — the card
    // shows up in the new stage there too, next time it loads.
    setDeals((prev) =>
      prev.map((d) => (d.id === dealId ? { ...d, stage_id: targetStageId } : d)),
    );
    const { error } = await supabase
      .from("deals")
      .update({ stage_id: targetStageId })
      .eq("id", dealId);
    if (error) {
      toast.error(t("toastFailedMove"));
      loadStagesAndDeals();
      return;
    }

    const newStage = sortedStages.find((s) => s.id === targetStageId);
    if (!newStage || !accountId) return;
    const {
      data: { session },
    } = await supabase.auth.getSession();
    await supabase.from("deal_activities").insert({
      deal_id: dealId,
      account_id: accountId,
      user_id: session?.user?.id ?? null,
      type: "stage_changed",
      title: tActivity("movedTo", { stage: newStage.name }),
      detail: tActivity("movedDetail"),
    });
  }

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="mb-3 flex shrink-0 items-center gap-2">
        <label className="text-xs font-medium text-muted-foreground">{t("pipeline")}</label>
        <select
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="h-8 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
        >
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDealId(null)}
        >
          <div className="flex flex-1 gap-3 overflow-x-auto pb-2">
            {sortedStages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                deals={dealsByStage.get(stage.id) ?? []}
                currency={defaultCurrency}
                onSelectConversation={onSelectConversation}
                emptyLabel={t("dropHere")}
              />
            ))}
          </div>

          <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
            {activeDeal ? (
              <div className="opacity-90">
                <KanbanCard deal={activeDeal} currency={defaultCurrency} onClick={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function KanbanColumn({
  stage,
  deals,
  currency,
  onSelectConversation,
  emptyLabel,
}: {
  stage: PipelineStage;
  deals: KanbanDeal[];
  currency: string;
  onSelectConversation: (conversationId: string) => void;
  emptyLabel: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex w-[280px] shrink-0 flex-col rounded-xl border border-border bg-card/60 p-3">
      <div className="-mx-3 -mt-3 h-[3px] rounded-t-xl" style={{ backgroundColor: stage.color }} />
      <div className="flex items-center justify-between pt-2">
        <h3 className="truncate text-sm font-semibold text-foreground">{stage.name}</h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {deals.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`mt-2 flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableKanbanCard
              key={deal.id}
              deal={deal}
              currency={currency}
              onClick={() => deal.conversation_id && onSelectConversation(deal.conversation_id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableKanbanCard({
  deal,
  currency,
  onClick,
}: {
  deal: KanbanDeal;
  currency: string;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: "none" }}
    >
      <KanbanCard deal={deal} currency={currency} onClick={onClick} />
    </div>
  );
}

function KanbanCard({
  deal,
  currency,
  onClick,
}: {
  deal: KanbanDeal;
  currency: string;
  onClick: () => void;
}) {
  const contact = deal.contact;
  const conversation = deal.conversation;
  const displayName = contact?.name || contact?.phone || deal.title;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border border-border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-primary/40"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
          {conversation?.last_message_text && (
            <p className="truncate text-xs text-muted-foreground">
              {conversation.last_message_text}
            </p>
          )}
        </div>
        {!!conversation?.unread_count && (
          <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
            {conversation.unread_count}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{formatCurrency(deal.value, deal.currency ?? currency)}</span>
        {conversation?.last_message_at && (
          <span>{formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: true })}</span>
        )}
      </div>
    </button>
  );
}
