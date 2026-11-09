"use client";

// The report document, laid out like Reportei's: the cover, the blocks of each network
// and, inside them, the indicators. In the editor every indicator has the bar that
// shows on hover (destacar, duplicar, editar, exportar, excluir), corner arrows to make
// it bigger or smaller, and can be dragged to another place. Read-only elsewhere
// ("ver como cliente", the public link).

import { useState } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowDownLeft, ArrowUpRight, Copy, Download, EyeOff, GripVertical, ListChecks, Plus, Settings, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ClientAvatar } from "@/app/operational/reportei/_components/client-avatar";
import { NetworkIcon } from "@/app/operational/reportei/_components/network-icon";
import {
  deleteBlock, deleteWidget, duplicateWidget, moveWidget, toggleHighlight, swapWidgets, toggleSize, updateBlock, updateCover, widgetToCsv, LIMITS,
  type Block, type ReportDoc, type Widget,
} from "@/lib/reportei/doc";
import { cn } from "@/lib/utils";
import { WidgetBody, spanOf } from "./widget-views";

export interface DocViewProps {
  doc: ReportDoc;
  title: string;
  clientName: string;
  logoUrl: string | null;
  /** "Relatório gerado dos dados analisados entre … comparado com …" */
  generatedText: string;
  editable: boolean;
  onChange?: (doc: ReportDoc) => void;
  selectedWidgetId?: string | null;
  onEditWidget?: (widgetId: string) => void;
  onAddMetrics?: (blockId: string) => void;
  onAddNetwork?: (atIndex: number) => void;
  onEditBlock?: (blockId: string) => void;
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "indicador";

function ToolButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn("flex h-7 w-7 items-center justify-center rounded text-primary transition-colors hover:bg-primary/15", danger && "hover:text-red-600")}
    >
      {children}
    </button>
  );
}

// The card under the pointer is the target; when the pointer is in a gap, the card it overlaps most.
const collide: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

function WidgetShell({
  w, props, dragId, landed,
}: {
  w: Widget; props: DocViewProps; dragId: string | null; landed: boolean;
}) {
  const { doc, editable, onChange, onEditWidget, selectedWidgetId } = props;
  const selected = selectedWidgetId === w.id;
  const change = (next: ReportDoc) => onChange?.(next);
  const drag = useDraggable({ id: w.id, disabled: !editable });
  const drop = useDroppable({ id: w.id, disabled: !editable });
  const setRefs = (node: HTMLElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  };
  const dragging = dragId === w.id;
  const over = drop.isOver && !!dragId && !dragging;

  return (
    <div ref={setRefs} className={cn("group relative", spanOf(w))}>
      <div
        {...(editable ? drag.attributes : {})}
        {...(editable ? drag.listeners : {})}
        onClick={editable ? () => onEditWidget?.(w.id) : undefined}
        className={cn(
          "relative h-full rounded-xl border border-transparent p-3 transition-[colors,transform] duration-150",
          landed && "[animation:reportei-settle_0.5s_cubic-bezier(0.34,1.56,0.64,1)]",
          editable && "cursor-grab select-none hover:border-primary/40 active:cursor-grabbing",
          selected && "border-primary",
          dragging && "border-transparent bg-transparent [&>*]:invisible",
          w.highlight && "border-amber-400/70 bg-amber-400/10",
          over && "scale-[1.03] -rotate-1 border-primary bg-primary/10 ring-2 ring-primary ring-offset-2 ring-offset-card",
        )}
      >
        {editable && (
          <div className="no-print absolute -top-3.5 left-3 z-10 hidden items-center gap-0.5 rounded-md bg-primary/10 px-1 py-0.5 shadow-sm backdrop-blur group-hover:flex">
            <ToolButton label={w.highlight ? "Remover destaque" : "Destacar"} onClick={() => change(toggleHighlight(doc, w.id))}>
              <Star className={cn("h-3.5 w-3.5", w.highlight && "fill-current")} />
            </ToolButton>
            <ToolButton label="Duplicar" onClick={() => change(duplicateWidget(doc, w.id))}>
              <Copy className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Editar" onClick={() => onEditWidget?.(w.id)}>
              <Settings className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Exportar" onClick={() => download(`${slug(w.title)}.csv`, widgetToCsv(w))}>
              <Download className="h-3.5 w-3.5" />
            </ToolButton>
            <ToolButton label="Excluir" danger onClick={() => change(deleteWidget(doc, w.id))}>
              <Trash2 className="h-3.5 w-3.5" />
            </ToolButton>
          </div>
        )}
        <WidgetBody w={w} />
        {editable && (
          <>
            <button
              type="button"
              aria-label={w.size === "wide" ? "Diminuir" : "Aumentar"}
              title={w.size === "wide" ? "Diminuir" : "Aumentar"}
              onClick={(e) => { e.stopPropagation(); change(toggleSize(doc, w.id)); }}
              className="no-print absolute bottom-1 left-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-primary group-hover:flex"
            >
              <ArrowDownLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={w.size === "wide" ? "Diminuir" : "Aumentar"}
              title={w.size === "wide" ? "Diminuir" : "Aumentar"}
              onClick={(e) => { e.stopPropagation(); change(toggleSize(doc, w.id)); }}
              className="no-print absolute bottom-1 right-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-primary group-hover:flex"
            >
              <ArrowUpRight className="h-3.5 w-3.5 rotate-90" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function AnalysisText({ value, editable, placeholder, onSave, className }: { value: string; editable: boolean; placeholder: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editable) return value ? <p className={cn("whitespace-pre-line text-sm text-foreground", className)}>{value}</p> : null;
  if (editing) {
    return (
      <Textarea
        autoFocus
        value={draft}
        maxLength={LIMITS.text}
        rows={3}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== value.trim()) onSave(draft.trim());
        }}
        className={className}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn("no-print mx-auto block rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary", value && "w-full whitespace-pre-line rounded-xl px-4 py-3 text-left text-sm text-foreground", className)}
    >
      {value || `+ ${placeholder}`}
    </button>
  );
}

function BlockView({ block, props, dragId, landed }: { block: Block; props: DocViewProps; dragId: string | null; landed: string[] }) {
  const { doc, editable, onChange, onAddMetrics, onEditBlock } = props;
  const change = (next: ReportDoc) => onChange?.(next);
  // Dropping on the empty part of a block sends the card to the end of it.
  const tail = useDroppable({ id: `block:${block.id}`, disabled: !editable });

  return (
    <section id={`block-${block.id}`} className={cn("scroll-mt-24 group/block rounded-2xl border border-border bg-card p-5 shadow-sm", block.hidden && "opacity-50")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {block.kind === "custom" ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground">
              <ListChecks className="h-5 w-5" />
            </span>
          ) : (
            <NetworkIcon network={block.network ?? ""} size={32} />
          )}
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {block.title}
              {block.hidden && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">Oculto</span>}
            </h2>
            <p className="text-xs text-muted-foreground">{block.subtitle}</p>
          </div>
        </div>
        {editable && (
          <div className="no-print flex items-center gap-2">
            <div className="hidden items-center gap-0.5 rounded-md bg-foreground/90 px-1 py-0.5 text-background group-hover/block:flex">
              <GripVertical className="h-4 w-4 opacity-70" aria-hidden />
              <button type="button" aria-label={block.hidden ? "Mostrar bloco" : "Ocultar bloco"} title={block.hidden ? "Mostrar bloco" : "Ocultar bloco"} onClick={() => change(updateBlock(doc, block.id, { hidden: !block.hidden }))} className="flex h-6 w-6 items-center justify-center rounded hover:bg-background/20">
                <EyeOff className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label="Configurar bloco" title="Configurar bloco" onClick={() => onEditBlock?.(block.id)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-background/20">
                <Settings className="h-3.5 w-3.5" />
              </button>
              <button type="button" aria-label="Excluir bloco" title="Excluir bloco" onClick={() => { if (window.confirm(`Excluir o bloco "${block.title}"?`)) change(deleteBlock(doc, block.id)); }} className="flex h-6 w-6 items-center justify-center rounded hover:bg-background/20">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {block.kind === "network" && (
              <Button size="sm" onClick={() => onAddMetrics?.(block.id)}>
                <Plus className="mr-1 h-4 w-4" />
                Adicionar métricas
              </Button>
            )}
          </div>
        )}
      </header>

      <div ref={(node) => tail.setNodeRef(node)} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-12">
        {block.widgets.map((w) => (
          <WidgetShell key={w.id} w={w} props={props} dragId={dragId} landed={landed.includes(w.id)} />
        ))}
        {block.widgets.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Nenhum indicador neste bloco ainda.</p>}
      </div>

      <div className="mt-4">
        <AnalysisText value={block.analysis} editable={editable} placeholder="Adicionar análise" onSave={(v) => change(updateBlock(doc, block.id, { analysis: v }))} />
      </div>
    </section>
  );
}

export function DocBody(props: DocViewProps) {
  const { doc, title, clientName, logoUrl, generatedText, editable, onChange, onAddNetwork } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [landed, setLanded] = useState<string[]>([]);
  const markLanded = (ids: string[]) => {
    setLanded(ids);
    setTimeout(() => setLanded([]), 600);
  };
  const visible = editable ? doc.blocks : doc.blocks.filter((b) => !b.hidden);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const activeWidget = dragId ? doc.blocks.flatMap((b) => b.widgets).find((x) => x.id === dragId) ?? null : null;

  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    const from = String(e.active.id);
    const to = e.over ? String(e.over.id) : null;
    setDragId(null);
    if (!to || !editable) return;
    if (to.startsWith("block:")) {
      const target = doc.blocks.find((b) => b.id === to.slice(6));
      if (!target) return;
      onChange?.(moveWidget(doc, from, target.id, target.widgets.length));
      markLanded([from]);
    } else if (to !== from) {
      // Dropping a card on another one swaps them, like trading two cards.
      onChange?.(swapWidgets(doc, from, to));
      markLanded([from, to]);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={collide} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
    <div className="space-y-6">
      {!doc.cover.hidden && (
        <section className="rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm">
          <div className="flex justify-center">
            <ClientAvatar name={clientName} logoUrl={logoUrl} size={96} className="[&_img]:rounded-2xl [&>span:first-child]:rounded-2xl" />
          </div>
          <h1 className="mx-auto mt-6 max-w-3xl text-3xl font-bold text-foreground">{title}</h1>
          <p className="mt-3 text-base text-muted-foreground">{doc.cover.subtitle}</p>
          <p className="mx-auto mt-8 max-w-xl text-sm text-foreground">{generatedText}</p>
          <div className="mx-auto mt-8 max-w-2xl">
            <AnalysisText value={doc.cover.analysis} editable={editable} placeholder="Clique aqui para adicionar uma análise" onSave={(v) => onChange?.(updateCover(doc, { analysis: v }))} />
          </div>
        </section>
      )}

      {visible.map((block, i) => (
        <div key={block.id} className="space-y-6">
          <BlockView block={block} props={props} dragId={dragId} landed={landed} />
          {editable && i < visible.length - 1 && (
            <button type="button" onClick={() => onAddNetwork?.(doc.blocks.indexOf(block) + 1)} className="no-print flex w-full items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-primary">
              <span className="h-px flex-1 bg-border" />
              <Plus className="h-4 w-4" />
              Adicionar rede
              <span className="h-px flex-1 bg-border" />
            </button>
          )}
        </div>
      ))}

      {editable && (
        <button type="button" onClick={() => onAddNetwork?.(doc.blocks.length)} className="no-print flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
          <Plus className="h-4 w-4" />
          Adicionar rede
        </button>
      )}
    </div>
    {/* The card in hand: solid and alive, following the pointer; its place on the page stays empty. */}
    <DragOverlay dropAnimation={{ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
      {activeWidget ? (
        <div className="h-full w-full cursor-grabbing rounded-xl border-2 border-primary bg-card p-3 shadow-2xl [animation:reportei-lift_0.18s_ease-out_forwards]">
          <WidgetBody w={activeWidget} />
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}
