"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  pointerWithin,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import type { Deal, DealTag, PipelineStage } from "@/types";
import { DealCard } from "./deal-card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import { useHorizontalWheelScroll } from "@/hooks/use-horizontal-wheel-scroll";
import { formatCurrency } from "@/lib/currency";
import { useTranslations } from "next-intl";
import { CARD_DROP_PREFIX, resolveDrop, type DropTarget } from "@/lib/ordering/column-order";

/** Dropping a card: prefer the card under the pointer (to place it), else the column. */
const detectCollisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((h) => String(h.id).startsWith(CARD_DROP_PREFIX) && h.id !== `${CARD_DROP_PREFIX}${args.active.id}`);
  if (card) return [card];
  if (hits.length > 0) return hits.filter((h) => !String(h.id).startsWith(CARD_DROP_PREFIX));
  // Nearest card/column, never the card being dragged itself.
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => c.id !== `${CARD_DROP_PREFIX}${args.active.id}`),
  });
};

/** Selection of deals (small square on each card; bulk bar appears with 1+ selected). Absent = no selection (no permission). */
export interface BoardSelection {
  selectedIds: Set<string>;
  /** Won / with-paperwork deals: shown with a lock, cannot be selected. */
  lockedIds: Set<string>;
  onToggle: (dealId: string) => void;
  /** Select (or clear) every selectable deal of one stage. */
  onToggleStage: (dealIds: string[], select: boolean) => void;
}

interface PipelineBoardProps {
  stages: PipelineStage[];
  deals: Deal[];
  onDealMoved: (dealId: string, newStageId: string) => void;
  /** A card was dropped: where (stage + before/after a card). Handles both the stage change and the personal order. */
  onReorder?: (dealId: string, targetStageId: string, target: DropTarget) => void;
  onAddDeal: (stageId: string) => void;
  onTagsChanged: (dealId: string, tags: DealTag[]) => void;
  selection?: BoardSelection;
}

export function PipelineBoard({
  stages,
  deals,
  onDealMoved,
  onReorder,
  onAddDeal,
  onTagsChanged,
  selection,
}: PipelineBoardProps) {
  const { defaultCurrency } = useAuth();
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  // Line shown above/below the card the dragged one would land next to.
  const [hint, setHint] = useState<{ cardId: string; where: "before" | "after" } | null>(null);
  // Only one deal's inline tag editor may be open at a time, across
  // the whole board — a single piece of state here (not per-card).
  const [tagEditorDealId, setTagEditorDealId] = useState<string | null>(null);

  // Click-and-drag-to-pan (Kommo-style): mousedown on empty board space
  // scrolls the board horizontally by following the cursor, instead of
  // requiring the native scrollbar. Only for mouse pointers — touch
  // already scrolls natively via the snap layout above.
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startScrollLeft: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  // A touchpad swipe over a card moves the board sideways, not only over the scrollbar.
  useHorizontalWheelScroll(scrollRef);

  function handleScrollPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-dnd-card], button, a, input, textarea, select")) return;
    const container = scrollRef.current;
    if (!container) return;
    e.preventDefault();
    panRef.current = { startX: e.clientX, startScrollLeft: container.scrollLeft };
    setIsPanning(true);
  }

  useEffect(() => {
    if (!isPanning) return;
    // Coalesce pointermove into one scrollLeft write per animation frame —
    // pointermove can fire faster than paint, and writing scrollLeft
    // synchronously on every event causes the janky/sticky feel.
    let rafId: number | null = null;
    let pendingClientX: number | null = null;

    function applyPendingScroll() {
      rafId = null;
      const pan = panRef.current;
      const container = scrollRef.current;
      if (!pan || !container || pendingClientX === null) return;
      container.scrollLeft = pan.startScrollLeft - (pendingClientX - pan.startX);
    }

    function handlePointerMove(e: PointerEvent) {
      pendingClientX = e.clientX;
      if (rafId === null) rafId = requestAnimationFrame(applyPendingScroll);
    }
    function stopPanning() {
      // Flush any movement still pending in the cancelled frame — otherwise
      // a drag that ends before the next frame paints (a quick flick, or a
      // release right after the last move) drops its final scroll update.
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        applyPendingScroll();
      }
      panRef.current = null;
      setIsPanning(false);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopPanning);
    window.addEventListener("pointercancel", stopPanning);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopPanning);
      window.removeEventListener("pointercancel", stopPanning);
    };
  }, [isPanning]);

  const sortedStages = useMemo(
    () => [...stages].sort((a, b) => a.position - b.position),
    [stages],
  );

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const stage of sortedStages) map.set(stage.id, []);
    for (const deal of deals) {
      const bucket = map.get(deal.stage_id);
      if (bucket) bucket.push(deal);
    }
    return map;
  }, [sortedStages, deals]);

  const sensors = useSensors(
    // 5px activation distance avoids clicks being interpreted as drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // Keyboard drag support: focus a card, Space to pick up, arrows to move,
    // Space to drop, Escape to cancel.
    useSensor(KeyboardSensor),
  );

  const activeDeal = activeDealId
    ? deals.find((d) => d.id === activeDealId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveDealId(String(event.active.id));
  }

  const stageOfCard = useCallback((cardId: string) => deals.find((d) => d.id === cardId)?.stage_id ?? null, [deals]);

  function resolve(event: DragOverEvent | DragEndEvent) {
    const { active, over } = event;
    if (!over) return null;
    return resolveDrop({
      overId: String(over.id),
      stageOfCard,
      overRect: over.rect,
      activeRect: active.rect.current.translated,
      activeId: String(active.id),
    });
  }

  function handleDragOver(event: DragOverEvent) {
    const r = resolve(event);
    if (!r || !r.overCardId || r.target === "top" || r.target === "end") {
      setHint(null);
      return;
    }
    setHint({ cardId: r.overCardId, where: "beforeId" in r.target ? "before" : "after" });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDealId(null);
    setHint(null);
    const r = resolve(event);
    if (!r) return;
    const dealId = String(event.active.id);
    const deal = deals.find((d) => d.id === dealId);
    if (!deal) return;
    if (!sortedStages.some((s) => s.id === r.stageId)) return;

    if (onReorder) {
      onReorder(dealId, r.stageId, r.target);
    } else if (deal.stage_id !== r.stageId) {
      onDealMoved(dealId, r.stageId);
    }
  }

  function handleDragCancel() {
    setActiveDealId(null);
    setHint(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={detectCollisions}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* snap-x + snap-mandatory on mobile so swipes land the next
          stage cleanly at the viewport edge instead of mid-column.
          Disabled on lg+ where snapping would interfere with the
          natural layout. The board can still overflow horizontally on
          lg+ once a pipeline has many stages (columns keep a 260px
          min-width), so a thin scrollbar stays visible on desktop. */}
      <div
        ref={scrollRef}
        onPointerDown={handleScrollPointerDown}
        className={`pipeline-scroll flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 lg:snap-none ${
          isPanning ? "cursor-grabbing select-none" : "cursor-grab"
        }`}
      >
        {sortedStages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const totalValue = stageDeals.reduce(
            (s, d) => s + Number(d.value || 0),
            0,
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              deals={stageDeals}
              totalValue={totalValue}
              currency={defaultCurrency}
              onAddDeal={onAddDeal}
              tagEditorDealId={tagEditorDealId}
              onToggleTagEditor={setTagEditorDealId}
              onTagsChanged={onTagsChanged}
              selection={selection}
              hint={hint}
            />
          );
        })}
      </div>

      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        }}
      >
        {activeDeal ? (
          <div className="opacity-90">
            <DealCard
              deal={activeDeal}
              stage={
                sortedStages.find((s) => s.id === activeDeal.stage_id) ?? null
              }
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>

      <style jsx>{`
        .pipeline-scroll {
          /* auto (not smooth) — smooth scrolling animates/interpolates
             every scrollLeft write with a delay, which fights the 1:1
             cursor tracking the drag-to-pan handler below needs. */
          scroll-behavior: auto;
        }
        /* On touch devices the peek/snap layout already signals there's
           more to swipe, so the scrollbar is hidden for a clean look.
           On desktop (mouse) the board can overflow with many stages
           and there is no peek hint, so keep a thin, themed scrollbar
           visible to make the overflow discoverable and usable. */
        @media (hover: none), (pointer: coarse) {
          .pipeline-scroll::-webkit-scrollbar {
            height: 0;
            display: none;
          }
          .pipeline-scroll {
            scrollbar-width: none;
          }
        }
        @media (hover: hover) and (pointer: fine) {
          .pipeline-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
          .pipeline-scroll::-webkit-scrollbar {
            height: 8px;
          }
          .pipeline-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb {
            background-color: var(--border);
            border-radius: 9999px;
          }
          .pipeline-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--muted-foreground);
          }
        }
      `}</style>
    </DndContext>
  );
}

function StageColumn({
  stage,
  deals,
  totalValue,
  currency,
  onAddDeal,
  tagEditorDealId,
  onToggleTagEditor,
  onTagsChanged,
  selection,
  hint,
}: {
  stage: PipelineStage;
  deals: Deal[];
  totalValue: number;
  currency: string;
  onAddDeal: (stageId: string) => void;
  tagEditorDealId: string | null;
  onToggleTagEditor: (dealId: string | null) => void;
  onTagsChanged: (dealId: string, tags: DealTag[]) => void;
  selection?: BoardSelection;
  hint: { cardId: string; where: "before" | "after" } | null;
}) {
  const t = useTranslations("Pipelines.board");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  const selecting = !!selection && selection.selectedIds.size > 0;
  const selectableIds = selection ? deals.filter((d) => !selection.lockedIds.has(d.id)).map((d) => d.id) : [];
  const allStageSelected =
    !!selection && selectableIds.length > 0 && selectableIds.every((id) => selection.selectedIds.has(id));

  return (
    // On mobile each column is `w-[85vw]` (with a reasonable min/max)
    // so the next column's edge peeks in — a "there's more here" hint.
    // snap-start lands each column cleanly when swiping. On lg+ we
    // restore the flex-1 share-the-row behavior. The droppable ref is
    // on the inner messages region below — intentionally NOT here, so
    // a drag over the column header doesn't highlight the whole column.
    <div className="flex w-[85vw] min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col rounded-xl border border-border bg-card/60 p-4 lg:w-auto lg:max-w-none lg:flex-1 lg:basis-[260px] lg:shrink lg:snap-none">
      {/* 3px colored top border — sits above the column's padding */}
      <div
        className="-mx-4 -mt-4 h-[3px] rounded-t-xl"
        style={{ backgroundColor: stage.color }}
      />
      <div className="flex items-center justify-between pt-3">
        {selection && selecting && (
          <Checkbox
            className="mr-2 shrink-0"
            checked={allStageSelected}
            disabled={selectableIds.length === 0}
            aria-label={t("selectStageAria", { stage: stage.name })}
            onCheckedChange={(checked) => selection.onToggleStage(selectableIds, checked === true)}
          />
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {stage.name}
        </h3>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
          {deals.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {formatCurrency(totalValue, currency)}
      </p>

      <div
        ref={setNodeRef}
        className={`mt-3 flex flex-1 flex-col gap-2 rounded-lg transition-all ${
          isOver
            ? "bg-primary/5 outline outline-2 outline-dashed outline-primary outline-offset-2"
            : ""
        }`}
      >
        {deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-border py-10 text-xs text-muted-foreground">
            {t("dropDealHere")}
          </div>
        ) : (
          deals.map((deal) => (
            <DraggableDealCard
              key={deal.id}
              deal={deal}
              stage={stage}
              tagEditorOpen={tagEditorDealId === deal.id}
              onToggleTagEditor={onToggleTagEditor}
              onTagsChanged={onTagsChanged}
              selection={selection}
              hint={hint?.cardId === deal.id ? hint.where : null}
            />
          ))
        )}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onAddDeal(stage.id)}
        className="mt-3 w-full justify-start border border-dashed border-border bg-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground"
      >
        <Plus className="mr-1 h-3 w-3" />
        {t("addDeal")}
      </Button>
    </div>
  );
}

function DraggableDealCard({
  deal,
  stage,
  tagEditorOpen,
  onToggleTagEditor,
  onTagsChanged,
  selection,
  hint,
}: {
  deal: Deal;
  stage: PipelineStage;
  tagEditorOpen: boolean;
  onToggleTagEditor: (dealId: string | null) => void;
  onTagsChanged: (dealId: string, tags: DealTag[]) => void;
  selection?: BoardSelection;
  hint: "before" | "after" | null;
}) {
  // While something is selected a click selects, so dragging is paused (a deal can't be
  // moved by accident).
  const selecting = !!selection && selection.selectedIds.size > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: deal.id,
    disabled: selecting,
  });

  // The card is also a drop spot: that is how the position inside a column is chosen.
  const { setNodeRef: setDropRef } = useDroppable({ id: `${CARD_DROP_PREFIX}${deal.id}` });
  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeRef(el);
      setDropRef(el);
    },
    [setNodeRef, setDropRef],
  );

  return (
    <div
      ref={setRefs}
      className="relative"
      data-dnd-card="true"
      {...(selecting ? {} : listeners)}
      {...(selecting ? {} : attributes)}
      style={{ opacity: isDragging ? 0.3 : 1, touchAction: selecting ? "auto" : "none" }}
    >
      {hint && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-1 right-1 z-10 h-0.5 rounded-full bg-primary ${
            hint === "before" ? "-top-1.5" : "-bottom-1.5"
          }`}
        />
      )}
      <DealCard
        deal={deal}
        stage={stage}
        tagEditorOpen={tagEditorOpen}
        onToggleTagEditor={onToggleTagEditor}
        onTagsChanged={onTagsChanged}
        selection={
          selection
            ? {
                selected: selection.selectedIds.has(deal.id),
                locked: selection.lockedIds.has(deal.id),
                active: selecting,
                onToggle: () => selection.onToggle(deal.id),
              }
            : undefined
        }
      />
    </div>
  );
}
