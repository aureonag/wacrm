"use client";

// A client's dashboard, in Reportei's v4 format: a bar with the name, the period (and its
// comparison), "Dados em tempo real", "Ver como cliente", Compartilhar and the menu; on the
// left a column with a shortcut to every block; and the blocks themselves, editable in
// place like a report (hover toolbar, drag to move, panels for metrics and blocks).
// Everything is saved by itself a moment after the last change.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, Copy, Eye, EyeOff, LayoutTemplate, ListChecks, Pencil, Plus, Printer, RefreshCw, Settings, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DocBody } from "@/components/reportei/report-doc-view";
import { emptyRealBlock, unavailableWidget } from "@/lib/reportei/meta-doc";
import { PRINT_CSS } from "@/components/reportei/report-view";
import { addBlock, addWidgets, findWidget, makeId, updateBlock, type MetricWidget, type ReportDoc } from "@/lib/reportei/doc";
import { NETWORK_CATALOG, demoBlock } from "@/lib/reportei/doc-catalog";
import { DASHBOARD_PRESETS, PRESET_LABEL, comparisonOf, formatRangeShort, rangeLength, resolveDashboardPreset, type DashboardPeriod, type DashboardPreset } from "@/lib/reportei/dashboard-doc";
import { layoutOfDoc } from "@/lib/reportei/doc-templates";
import { showDate } from "@/lib/reportei/format";
import { resolvePeriod } from "@/lib/reportei/periods";
import { cn } from "@/lib/utils";
import { AddNetworkDialog, AddPanel, PanelShell, Toggle, WidgetPanel, label } from "./report-doc-editor";
import { NetworkIcon } from "./network-icon";
import { SaveLayoutTemplateDialog } from "./save-layout-template-dialog";

export interface EditorDashboard {
  id: string;
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  title: string;
  doc: ReportDoc;
  period: DashboardPeriod;
  compare: boolean;
  realtime: boolean;
}

type Panel = { kind: "settings" } | { kind: "widget"; id: string } | { kind: "add"; blockId: string } | { kind: "block"; id: string } | null;
type SaveState = "saved" | "saving" | "error";

const patchApi = (id: string, body: unknown) => fetch(`/api/operational/reportei/client-dashboards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function PeriodSelector({ period, compare, disabled, onApply }: { period: DashboardPeriod; compare: boolean; disabled: boolean; onApply: (p: DashboardPeriod, compare: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(period);
  const [cmp, setCmp] = useState(compare);
  const box = useRef<HTMLDivElement>(null);
  const today = resolvePeriod("last_7d").until;
  const compared = comparisonOf(period);
  const days = rangeLength(period.since, period.until);
  const presetName = period.preset === "custom" ? "Período personalizado" : PRESET_LABEL[period.preset];
  // "Últimos 7 dias" already says how long it is; the others get the length after the name.
  const periodLabel = /[0-9]+ dias/.test(presetName) ? presetName : `${presetName} · ${days} ${days === 1 ? "dia" : "dias"}`;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (preset: DashboardPreset) => setDraft({ preset, ...resolveDashboardPreset(preset, today) });
  const valid = draft.since && draft.until && draft.since <= draft.until && draft.until <= today;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(period);
          setCmp(compare);
          setOpen((o) => !o);
        }}
        className={cn("flex items-stretch overflow-hidden rounded-xl border bg-card text-left transition-colors hover:bg-muted/30", open ? "border-primary ring-2 ring-primary/20" : "border-border")}
      >
        <span className="flex items-center gap-3 px-3.5 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarDays className="h-4 w-4" />
          </span>
          <span className="whitespace-nowrap">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {periodLabel}
            </span>
            <span className="block text-sm font-semibold text-foreground">{formatRangeShort(period.since, period.until)}</span>
          </span>
        </span>
        <span className={cn("flex items-center gap-3 border-l border-border px-3.5 py-2", compare ? "bg-muted/40" : "")}>
          <span className="whitespace-nowrap">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Comparado com</span>
            <span className={cn("block text-sm font-semibold", compare ? "text-foreground" : "font-medium text-muted-foreground")}>{compare ? formatRangeShort(compared.since, compared.until) : "Sem comparação"}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </span>
      </button>

      {open && (
        <div className="absolute left-1/2 top-full z-30 mt-2 w-[26rem] max-w-[92vw] -translate-x-1/2 rounded-2xl border border-border bg-popover p-4 shadow-xl">
          <p className="mb-3 text-sm font-semibold text-primary">Período de análise</p>
          <div className="grid grid-cols-[11rem_1fr] gap-4">
            <ul className="space-y-0.5">
              {DASHBOARD_PRESETS.map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => choose(p)} className={cn("w-full rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted", draft.preset === p ? "font-semibold text-primary" : "text-foreground")}>
                    {PRESET_LABEL[p]}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => setDraft({ ...draft, preset: "custom" })} className={cn("flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted", draft.preset === "custom" ? "font-semibold text-primary" : "text-foreground")}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  Período personalizado
                </button>
              </li>
            </ul>
            <div className="space-y-2">
              <label className="block text-[11px] text-muted-foreground">
                De
                <Input type="date" value={draft.since} max={draft.until || today} onChange={(e) => setDraft({ ...draft, preset: "custom", since: e.target.value })} className="mt-0.5 h-8 text-xs" />
              </label>
              <label className="block text-[11px] text-muted-foreground">
                Até
                <Input type="date" value={draft.until} min={draft.since} max={today} onChange={(e) => setDraft({ ...draft, preset: "custom", until: e.target.value })} className="mt-0.5 h-8 text-xs" />
              </label>
              {draft.since && draft.until && valid && <p className="text-[11px] text-muted-foreground">Comparação: {showDate(comparisonOf(draft).since)} - {showDate(comparisonOf(draft).until)}</p>}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <Toggle label="Comparação com o período anterior" checked={cmp} onChange={setCmp} />
            <Button
              size="sm"
              disabled={!valid}
              onClick={() => {
                setOpen(false);
                onApply(draft, cmp);
              }}
            >
              Aplicar período
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DashboardDocEditor({ dashboard, canEdit }: { dashboard: EditorDashboard; canEdit: boolean }) {
  const router = useRouter();
  const [doc, setDoc] = useState<ReportDoc>(dashboard.doc);
  const [title, setTitle] = useState(dashboard.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [period, setPeriod] = useState(dashboard.period);
  const [compare, setCompare] = useState(dashboard.compare);
  const [realtime, setRealtime] = useState(dashboard.realtime);
  const [save, setSave] = useState<SaveState>("saved");
  const [panel, setPanel] = useState<Panel>(null);
  const [preview, setPreview] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [networkAt, setNetworkAt] = useState<number | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const skipSave = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = canEdit && !preview && !loadingPeriod;

  const persist = useCallback(
    async (next: ReportDoc) => {
      setSave("saving");
      try {
        const res = await patchApi(dashboard.id, { doc: next });
        setSave(res.ok ? "saved" : "error");
      } catch {
        setSave("error");
      }
    },
    [dashboard.id],
  );

  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    if (!canEdit) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(doc), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc, canEdit, persist]);

  async function applyPeriod(next: DashboardPeriod, nextCompare: boolean) {
    setLoadingPeriod(true);
    setSave("saving");
    try {
      const res = await patchApi(dashboard.id, { period: next, compare: nextCompare });
      if (!res.ok) throw new Error("period");
      const { doc: fresh, unreadable } = (await res.json()) as { doc: ReportDoc | null; unreadable?: string[] };
      skipSave.current = true;
      setPeriod(next);
      setCompare(nextCompare);
      // Changing only the period keeps each indicator's own comparison choice; the switch applies to all only when it was toggled.
      if (fresh) setDoc(nextCompare !== compare ? setComparison(fresh, nextCompare) : fresh);
      if (unreadable && unreadable.length > 0) toast.warning(`Não foi possível ler: ${unreadable.join(", ")}. Os indicadores dessas contas ficaram sem número para este período.`);
      setSave("saved");
    } catch {
      setSave("error");
      toast.error("Não foi possível aplicar o período.");
    } finally {
      setLoadingPeriod(false);
    }
  }

  function setComparison(d: ReportDoc, on: boolean): ReportDoc {
    return { ...d, blocks: d.blocks.map((b) => ({ ...b, widgets: b.widgets.map((w) => (w.kind === "metric" ? ({ ...w, comparison: on && w.previous !== null } as MetricWidget) : w)) })) };
  }

  async function toggleRealtime(v: boolean) {
    setRealtime(v);
    const res = await patchApi(dashboard.id, { realtime: v }).catch(() => null);
    if (!res?.ok) {
      setRealtime(!v);
      toast.error("Não foi possível salvar.");
    }
  }

  async function saveTitle(next: string) {
    const name = next.trim();
    setEditingTitle(false);
    if (!name || name === title) return;
    setTitle(name);
    const res = await patchApi(dashboard.id, { title: name }).catch(() => null);
    if (!res?.ok) toast.error("Não foi possível salvar o nome.");
  }

  async function duplicate() {
    const res = await fetch(`/api/operational/reportei/client-dashboards/${dashboard.id}/duplicate`, { method: "POST" }).catch(() => null);
    if (!res?.ok) return toast.error("Não foi possível duplicar.");
    const { id } = (await res.json()) as { id: string };
    toast.success("Dashboard duplicado.");
    router.push(`/operational/reportei/dashboards/${dashboard.clientId}/v4/${id}`);
  }

  async function remove() {
    if (!window.confirm("Excluir este dashboard? Isso não pode ser desfeito.")) return;
    const res = await fetch(`/api/operational/reportei/client-dashboards/${dashboard.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error("Não foi possível excluir.");
    router.push(`/operational/reportei/clientes/${dashboard.clientId}`);
  }

  const widgetFound = panel?.kind === "widget" ? findWidget(doc, panel.id) : null;
  const widget = widgetFound ? widgetFound.block.widgets[widgetFound.index] : null;
  const addTarget = panel?.kind === "add" ? doc.blocks.find((b) => b.id === panel.blockId) : null;
  const editedBlock = panel?.kind === "block" ? doc.blocks.find((b) => b.id === panel.id) : null;
  const generatedText = useMemo(() => "", []);
  const saveLabel = save === "saving" ? "Salvando…" : save === "error" ? "Erro ao salvar" : "Salvo";
  const clientHref = `/operational/reportei/clientes/${dashboard.clientId}`;

  const body = (
    <div id="report-print">
      {doc.demo && (
        <p className="mb-4 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
          Dashboard-modelo com números fictícios, só para validar a interface. Os dados reais entram quando as redes forem integradas.
        </p>
      )}
      <div className={cn(loadingPeriod && "pointer-events-none opacity-50 transition-opacity")}>
        <DocBody
          doc={doc}
          title={title}
          clientName={dashboard.clientName}
          logoUrl={dashboard.logoUrl}
          generatedText={generatedText}
          editable={editable}
          onChange={setDoc}
          selectedWidgetId={panel?.kind === "widget" ? panel.id : null}
          onEditWidget={(id) => setPanel({ kind: "widget", id })}
          onAddMetrics={(blockId) => setPanel({ kind: "add", blockId })}
          onAddNetwork={(at) => setNetworkAt(at)}
          onEditBlock={(id) => setPanel({ kind: "block", id })}
        />
      </div>
    </div>
  );

  if (preview) {
    return (
      <div className="space-y-4">
        <style>{PRINT_CSS}</style>
        <div className="no-print flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Você está vendo o dashboard como o cliente vê.</span>
          <Button size="sm" variant="outline" onClick={() => setPreview(false)}>
            <EyeOff className="mr-1.5 h-4 w-4" />
            Sair da visualização
          </Button>
        </div>
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        {body}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>

      <Link href={clientHref} className="no-print relative z-30 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Voltar para {dashboard.clientName}
      </Link>

      <header className="no-print sticky top-0 z-20 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-background sm:before:h-6 -mx-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-background/95 px-1 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 items-center gap-2">
            {editingTitle ? (
              <Input autoFocus defaultValue={title} maxLength={200} className="h-9 w-80 max-w-full text-lg font-semibold" onBlur={(e) => void saveTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingTitle(false); }} />
            ) : (
              <h1 className="truncate text-xl font-bold text-foreground">{title}</h1>
            )}
            {canEdit && !editingTitle && (
              <button type="button" aria-label="Editar o título" onClick={() => setEditingTitle(true)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <PeriodSelector period={period} compare={compare} disabled={!canEdit || loadingPeriod} onApply={(p, c) => void applyPeriod(p, c)} />
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-5">
          {save === "error" && <span className="text-xs font-medium text-red-600">{saveLabel}</span>}
          <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap text-xs font-medium text-emerald-600">
            <RefreshCw className="h-4 w-4 stroke-[2.75]" aria-hidden />
            Dados em tempo real
            <button type="button" role="switch" aria-checked={realtime} disabled={!canEdit} onClick={() => void toggleRealtime(!realtime)} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", realtime ? "bg-emerald-500" : "bg-muted-foreground/30")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", realtime ? "left-[1.1rem]" : "left-0.5")} />
            </button>
          </label>
          <Button variant="outline" size="sm" onClick={() => setPreview(true)}>
            <Eye className="mr-1.5 h-4 w-4" />
            Ver como cliente
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              <Share2 className="h-4 w-4" />
              Compartilhar
              <ChevronDown className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-60">
              <DropdownMenuItem onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Compartilhar via PDF
              </DropdownMenuItem>
              <DropdownMenuItem disabled>Compartilhar por link (em breve)</DropdownMenuItem>
              <DropdownMenuItem disabled>Compartilhar por WhatsApp (em breve)</DropdownMenuItem>
              <DropdownMenuItem disabled>Compartilhar por e-mail (em breve)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Configurações" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Settings className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-60">
              <DropdownMenuItem onClick={() => setPanel({ kind: "settings" })}>
                <Settings className="mr-2 h-4 w-4" />
                Configurações do dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSavingTemplate(true)}>
                <LayoutTemplate className="mr-2 h-4 w-4" />
                Salvar como template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPreview(true)}>
                <Eye className="mr-2 h-4 w-4" />
                Visualizar como cliente
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onClick={() => void duplicate()}>
                  <Copy className="mr-2 h-4 w-4" />
                  Duplicar dashboard
                </DropdownMenuItem>
              )}
              {canEdit && <DropdownMenuSeparator />}
              {canEdit && (
                <DropdownMenuItem onClick={() => void remove()} className="text-red-600">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir dashboard
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex items-start gap-4">
        <nav aria-label="Blocos do dashboard" className="no-print sticky top-24 z-10 flex shrink-0 flex-col items-start gap-1.5 self-start">
          <button type="button" aria-label={railOpen ? "Recolher a lista de blocos" : "Expandir a lista de blocos"} onClick={() => setRailOpen((o) => !o)} className="mb-1 flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground">
            {railOpen ? <ChevronsLeft className="h-3.5 w-3.5" /> : <ChevronsRight className="h-3.5 w-3.5" />}
          </button>
          {doc.blocks.map((b) => (
            <button
              key={b.id}
              type="button"
              title={b.title}
              onClick={() => document.getElementById(`block-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="flex items-center gap-2 rounded-lg p-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
            >
              {b.network ? <NetworkIcon network={b.network} size={20} /> : <ListChecks className="h-5 w-5 text-muted-foreground" />}
              {railOpen && <span className="max-w-32 truncate">{b.title}</span>}
            </button>
          ))}
          {editable && (
            <button type="button" title="Adicionar rede" onClick={() => setNetworkAt(doc.blocks.length)} className="flex items-center gap-2 rounded-lg p-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-primary">
              <Plus className="h-5 w-5" />
              {railOpen && <span>Adicionar rede</span>}
            </button>
          )}
        </nav>

        {panel?.kind === "settings" && (
          <PanelShell title="Configurações" onClose={() => setPanel(null)}>
            <div className="space-y-3">
              <label className={label}>
                Nome do dashboard
                <Input defaultValue={title} maxLength={200} disabled={!canEdit} onBlur={(e) => void saveTitle(e.target.value)} />
              </label>
              <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <p className="text-sm font-semibold text-primary">Período de análise</p>
                <p>
                  {showDate(period.since)} a {showDate(period.until)}
                </p>
                <p>{compare ? `Comparado com ${showDate(comparisonOf(period).since)} a ${showDate(comparisonOf(period).until)}` : "Sem comparação"}</p>
                <p className="pt-1">Mude o período na barra de cima: os números são lidos de novo.</p>
              </div>
            </div>
          </PanelShell>
        )}
        {panel?.kind === "widget" && widget && <WidgetPanel w={widget} doc={doc} onChange={setDoc} onClose={() => setPanel(null)} periodKey={`${period.since}|${period.until}`} />}
        {addTarget && (
          <AddPanel
            block={addTarget}
            demo={doc.demo}
            onClose={() => setPanel(null)}
            onAdd={(key) => {
              const entry = addTarget.network ? NETWORK_CATALOG[addTarget.network]?.find((e) => e.key === key) : null;
              if (!entry) return;
              {
                const made = entry.make({ id: makeId("w"), range: period, seed: `${dashboard.id}:${Date.now()}` });
                // A real document never gets made-up numbers: the new indicator waits, empty, for the next refresh of real data.
                setDoc(addWidgets(doc, addTarget.id, [doc.demo ? made : unavailableWidget(made, "Indicador novo: o número chega quando o período for atualizado.")]));
              }
              toast.success("Métrica adicionada ao final do bloco.");
            }}
          />
        )}
        {editedBlock && (
          <PanelShell title={editedBlock.title} subtitle="Configuração do bloco" onClose={() => setPanel(null)}>
            <div className="space-y-3">
              <label className={label}>
                Título
                <Input value={editedBlock.title} maxLength={200} onChange={(e) => setDoc(updateBlock(doc, editedBlock.id, { title: e.target.value }))} />
              </label>
              <label className={label}>
                {editedBlock.kind === "custom" ? "Descrição" : "Conta"}
                <Input value={editedBlock.subtitle} maxLength={200} onChange={(e) => setDoc(updateBlock(doc, editedBlock.id, { subtitle: e.target.value }))} />
              </label>
              <Toggle label="Ocultar este bloco" checked={editedBlock.hidden} onChange={(v) => setDoc(updateBlock(doc, editedBlock.id, { hidden: v }))} />
            </div>
          </PanelShell>
        )}

        <div className="min-w-0 flex-1">{body}</div>
      </div>

      {networkAt !== null && (
        <AddNetworkDialog
          clientName={dashboard.clientName}
          onClose={() => setNetworkAt(null)}
          onAdd={(network, account) => {
            {
              const made = demoBlock(network, account, period, `${dashboard.id}:${network}:${doc.blocks.length}`, makeId);
              setDoc(addBlock(doc, doc.demo ? made : emptyRealBlock(made), networkAt));
            }
            setNetworkAt(null);
          }}
          demo={doc.demo}
        />
      )}
      {savingTemplate && (
        <SaveLayoutTemplateDialog
          layout={layoutOfDoc(doc)}
          defaultName={title}
          onClose={() => setSavingTemplate(false)}
          onSaved={() => {
            setSavingTemplate(false);
            toast.success("Template criado. Ele aparece em Templates.");
          }}
        />
      )}
    </div>
  );
}
