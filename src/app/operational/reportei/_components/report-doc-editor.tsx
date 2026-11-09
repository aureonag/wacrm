"use client";

// The report page of Reportei → Relatórios, as a document you edit in place, like
// Reportei's: a top bar (name, "Salvo", template, preview, share, menu), three cards
// (period, automation, share link), the document and, on the left, the panel of
// whatever is selected (report settings, an indicator, the metrics to add, a block).
// Every change is saved by itself a moment later.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, BarChart3, CalendarDays, ChevronDown, ChevronLeft, Copy, Eye, EyeOff, Hash, Image as ImageIcon, LayoutTemplate, LineChart, Link2, Pencil, PieChart, Plus, Printer, Search, Settings, Share2, Table2, Trash2, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DocBody } from "@/components/reportei/report-doc-view";
import { emptyRealBlock, unavailableWidget } from "@/lib/reportei/meta-doc";
import { PRINT_CSS } from "@/components/reportei/report-view";
import { findWidget, makeId, addBlock, addWidgets, deleteWidget, updateBlock, updateCover, updateWidget, type Block, type MetricWidget, type ReportDoc, type Widget, type WidgetKind } from "@/lib/reportei/doc";
import { CATALOG_NETWORKS, NETWORK_CATALOG, NETWORK_LABEL, demoBlock } from "@/lib/reportei/doc-catalog";
import { layoutOfDoc } from "@/lib/reportei/doc-templates";
import { showDate } from "@/lib/reportei/format";
import type { ReportSnapshot } from "@/lib/reportei/report";
import { cn } from "@/lib/utils";
import { NetworkIcon } from "./network-icon";
import { ShareReport } from "./share-report";
import { SaveLayoutTemplateDialog } from "./save-layout-template-dialog";

export interface EditorReport {
  id: string;
  clientId: string;
  clientName: string;
  logoUrl: string | null;
  title: string;
  snapshot: ReportSnapshot & { doc: ReportDoc };
  shareToken: string | null;
  shareExpiresAt: string | null;
  createdAt: string;
}

type Panel = { kind: "settings" } | { kind: "widget"; id: string } | { kind: "add"; blockId: string } | { kind: "block"; id: string } | null;
type SaveState = "saved" | "saving" | "error";

const KIND_ICON: Record<WidgetKind, typeof Hash> = { metric: Hash, bar: BarChart3, groupedBar: BarChart3, line: LineChart, pie: PieChart, table: Table2, posts: Table2, stories: ImageIcon };

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5 text-sm text-foreground">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-emerald-500" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[1.1rem]" : "left-0.5")} />
      </button>
    </label>
  );
}

export function PanelShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="no-print sticky top-20 max-h-[calc(100vh-6rem)] w-72 shrink-0 self-start overflow-y-auto rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          <h2 className="text-sm font-semibold text-primary">{title}</h2>
        </div>
        <button type="button" aria-label="Fechar painel" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      {children}
    </aside>
  );
}

export const label = "block space-y-1 text-xs text-muted-foreground";

export function WidgetPanel({ w, doc, onChange, onClose, periodKey }: { w: Widget; doc: ReportDoc; onChange: (d: ReportDoc) => void; onClose: () => void; periodKey: string }) {
  const patch = (p: Partial<Widget>) => onChange(updateWidget(doc, w.id, p));
  const m = w.kind === "metric" ? (w as MetricWidget) : null;
  return (
    <PanelShell title={w.title} subtitle="Configuração da métrica" onClose={onClose}>
      <div className="space-y-3">
        <label className={label}>
          Título
          <Input value={w.title} maxLength={200} onChange={(e) => patch({ title: e.target.value })} />
        </label>
        <label className={label}>
          Descrição
          <Textarea value={w.description} maxLength={1000} rows={4} onChange={(e) => patch({ description: e.target.value })} className="text-xs" />
        </label>
        {m && (
          <>
            <label className={label}>
              Casas decimais
              <Input type="number" min={0} max={6} value={m.decimals} onChange={(e) => patch({ decimals: Math.max(0, Math.min(6, Number(e.target.value) || 0)) } as Partial<Widget>)} />
            </label>
            <Toggle label="Valor de comparação" checked={m.comparison} onChange={(v) => patch({ comparison: v } as Partial<Widget>)} />
            <Toggle label="Variações com valor absoluto" checked={m.absolute} onChange={(v) => patch({ absolute: v } as Partial<Widget>)} />
            <label className={label}>
              Aumento da variação
              <select value={m.upIsGood ? "good" : "bad"} onChange={(e) => patch({ upIsGood: e.target.value === "good" } as Partial<Widget>)} className="h-9 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground dark:bg-input/30">
                <option value="good">▲ Positivo</option>
                <option value="bad">▲ Negativo</option>
              </select>
            </label>
            <fieldset className="space-y-1.5 border-t border-border pt-3">
              <legend className="text-sm font-semibold text-primary">Período de análise</legend>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" name={`p-${w.id}`} checked={!m.period} onChange={() => patch({ period: null })} className="accent-primary" />
                Mesmo período do relatório
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" name={`p-${w.id}`} checked={!!m.period} onChange={() => patch({ period: m.period ?? { since: periodKey.split("|")[0], until: periodKey.split("|")[1] } })} className="accent-primary" />
                Período personalizado
              </label>
              {m.period && (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" value={m.period.since} max={m.period.until} onChange={(e) => e.target.value && patch({ period: { since: e.target.value, until: m.period!.until } })} />
                  <Input type="date" value={m.period.until} min={m.period.since} onChange={(e) => e.target.value && patch({ period: { since: m.period!.since, until: e.target.value } })} />
                </div>
              )}
            </fieldset>
          </>
        )}
        <Button variant="outline" size="sm" className="w-full text-red-600 hover:text-red-600" onClick={() => { onChange(deleteWidget(doc, w.id)); onClose(); }}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          Excluir indicador
        </Button>
      </div>
    </PanelShell>
  );
}

export function AddPanel({ block, onAdd, onClose, demo }: { block: Block; onAdd: (key: string) => void; onClose: () => void; demo: boolean }) {
  const [tab, setTab] = useState<"preset" | "custom">("preset");
  const [query, setQuery] = useState("");
  const entries = (block.network ? NETWORK_CATALOG[block.network] : undefined) ?? [];
  const q = query.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = entries.filter((e) => !q || e.title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q));
  return (
    <PanelShell title="Métricas" subtitle={block.title} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {(["preset", "custom"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("rounded-lg border px-2 py-3 text-xs font-medium transition-colors", tab === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted/50")}>
            {t === "preset" ? "Métricas predefinidas" : "Métricas personalizáveis"}
          </button>
        ))}
      </div>
      {tab === "custom" ? (
        <p className="mt-4 text-xs text-muted-foreground">Em breve: criar uma métrica combinando campos da rede.</p>
      ) : (
        <>
          <p className="mt-4 text-xs font-semibold text-primary">Métricas predefinidas</p>
          <p className="text-[11px] text-muted-foreground">Lista de métricas disponibilizadas pela rede.</p>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar..." className="h-9 pl-8 text-sm" />
          </div>
          {!demo && <p className="mt-3 text-xs text-muted-foreground">Os números desta rede entram quando a integração estiver ligada.</p>}
          <ul className="mt-2 divide-y divide-border">
            {shown.map((e) => {
              const Icon = KIND_ICON[e.kind];
              return (
                <li key={e.key}>
                  <button type="button" disabled={!demo} onClick={() => onAdd(e.key)} className="flex w-full items-center gap-2.5 px-1 py-2.5 text-left text-xs text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50">
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {e.title}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="py-4 text-center text-xs text-muted-foreground">Nenhuma métrica encontrada.</li>}
          </ul>
        </>
      )}
    </PanelShell>
  );
}

export function ReportDocEditor({ report, canEdit }: { report: EditorReport; canEdit: boolean }) {
  const router = useRouter();
  const [doc, setDoc] = useState<ReportDoc>(report.snapshot.doc);
  const [title, setTitle] = useState(report.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [save, setSave] = useState<SaveState>("saved");
  const [panel, setPanel] = useState<Panel>(null);
  const [preview, setPreview] = useState(false);
  const [networkAt, setNetworkAt] = useState<number | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { period, compare } = report.snapshot;
  const editable = canEdit && !preview;

  // Autosave: a moment after the last change, the whole document goes to the server.
  const persist = useCallback(
    async (next: ReportDoc) => {
      setSave("saving");
      try {
        const res = await fetch(`/api/operational/reportei/reports/${report.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: next }) });
        setSave(res.ok ? "saved" : "error");
      } catch {
        setSave("error");
      }
    },
    [report.id],
  );

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!canEdit) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(doc), 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [doc, canEdit, persist]);

  async function saveTitle(next: string) {
    const name = next.trim();
    setEditingTitle(false);
    if (!name || name === title) return;
    setTitle(name);
    const res = await fetch(`/api/operational/reportei/reports/${report.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name }) }).catch(() => null);
    if (!res?.ok) toast.error("Não foi possível salvar o nome.");
  }

  async function duplicate() {
    const res = await fetch(`/api/operational/reportei/reports/${report.id}/duplicate`, { method: "POST" }).catch(() => null);
    if (!res?.ok) return toast.error("Não foi possível duplicar.");
    const { id } = (await res.json()) as { id: string };
    toast.success("Relatório duplicado.");
    router.push(`/operational/reportei/relatorios/${id}`);
  }

  async function remove() {
    if (!window.confirm("Excluir este relatório? Isso não pode ser desfeito.")) return;
    const res = await fetch(`/api/operational/reportei/reports/${report.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error("Não foi possível excluir.");
    router.push(`/operational/reportei/clientes/${report.clientId}`);
  }

  const generatedText = useMemo(
    () => `Relatório gerado dos dados analisados entre ${showDate(period.since)} e ${showDate(period.until)}${compare ? ` comparado com os dados coletados entre ${showDate(compare.since)} e ${showDate(compare.until)}` : ""}.`,
    [period, compare],
  );

  const widgetPanel = panel?.kind === "widget" ? findWidget(doc, panel.id) : null;
  const widget = widgetPanel ? widgetPanel.block.widgets[widgetPanel.index] : null;
  const addBlockTarget = panel?.kind === "add" ? doc.blocks.find((b) => b.id === panel.blockId) : null;
  const editedBlock = panel?.kind === "block" ? doc.blocks.find((b) => b.id === panel.id) : null;

  const saveLabel = save === "saving" ? "Salvando…" : save === "error" ? "Erro ao salvar" : "Salvo";

  const body = (
    <div id="report-print">
      {doc.demo && (
        <p className="mb-4 rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
          MODELO COM NÚMEROS FICTÍCIOS: só para validar a interface. Não é um resultado real e não pode ser compartilhado por link.
        </p>
      )}
      <DocBody
        doc={doc}
        title={title}
        clientName={report.clientName}
        logoUrl={report.logoUrl}
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
  );

  if (preview) {
    return (
      <div className="space-y-4">
        <style>{PRINT_CSS}</style>
        <div className="no-print flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
          <span className="text-muted-foreground">Você está vendo o relatório como o cliente vê.</span>
          <Button size="sm" variant="outline" onClick={() => setPreview(false)}>
            <EyeOff className="mr-1.5 h-4 w-4" />
            Sair da visualização
          </Button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>

      <Link href={`/operational/reportei/clientes/${report.clientId}`} className="no-print relative z-30 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        Voltar para {report.clientName}
      </Link>

      <header className="no-print sticky top-0 z-20 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-4 before:bg-background sm:before:h-6 -mx-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border bg-background/95 px-1 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {editingTitle ? (
            <Input autoFocus defaultValue={title} maxLength={200} className="h-9 w-80 max-w-full text-lg font-semibold" onBlur={(e) => void saveTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingTitle(false); }} />
          ) : (
            <h1 className="truncate text-xl font-bold text-foreground">{title}</h1>
          )}
          {canEdit && !editingTitle && (
            <button type="button" aria-label="Editar o nome" onClick={() => setEditingTitle(true)} className="rounded p-1 text-muted-foreground hover:text-foreground">
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-5">
          {save === "error" && <span className="text-xs font-medium text-red-600">{saveLabel}</span>}
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
            <DropdownMenuContent align="end" sideOffset={6} className="w-64">
              <DropdownMenuItem disabled={doc.demo} onClick={() => document.getElementById("share-card")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
                <Link2 className="mr-2 h-4 w-4" />
                Compartilhar por link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Compartilhar via PDF
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(`/operational/reportei/clientes/${report.clientId}`)}>
                <Zap className="mr-2 h-4 w-4" />
                Automatizar a geração
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Configurações" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <Settings className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6} className="w-60">
              <DropdownMenuItem onClick={() => setPanel({ kind: "settings" })}>
                <Settings className="mr-2 h-4 w-4" />
                Configurações do relatório
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
                  Duplicar relatório
                </DropdownMenuItem>
              )}
              {canEdit && <DropdownMenuSeparator />}
              {canEdit && (
                <DropdownMenuItem onClick={() => void remove()} className="text-red-600">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir relatório
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="no-print grid gap-4 lg:grid-cols-3">
        <section className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
            <CalendarDays className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              {showDate(period.since)} - {showDate(period.until)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{compare ? `Comparação: ${showDate(compare.since)} - ${showDate(compare.until)}` : "Sem comparação"}</p>
          </div>
          <button type="button" aria-label="Configurações do relatório" onClick={() => setPanel({ kind: "settings" })} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Pencil className="h-4 w-4" />
          </button>
        </section>
        <section className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500/15 text-orange-600">
            <Zap className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Receba esse relatório automaticamente</p>
            <Link href={`/operational/reportei/clientes/${report.clientId}`} className="text-xs font-medium text-orange-600 hover:underline">
              Automatizar geração do relatório
            </Link>
          </div>
        </section>
        <section id="share-card" className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Link de compartilhamento</p>
          {doc.demo ? <p className="text-xs text-muted-foreground">Modelo fictício não pode ser compartilhado.</p> : canEdit ? <ShareReport reportId={report.id} initialToken={report.shareToken} initialExpiresAt={report.shareExpiresAt} /> : <p className="text-xs text-muted-foreground">Somente quem edita pode compartilhar.</p>}
        </section>
      </div>

      <div className="flex items-start gap-5">
        {panel?.kind === "settings" && (
          <PanelShell title="Configurações" onClose={() => setPanel(null)}>
            <div className="space-y-3">
              <label className={label}>
                Nome do relatório
                <Input defaultValue={title} maxLength={200} disabled={!canEdit} onBlur={(e) => void saveTitle(e.target.value)} />
              </label>
              <label className={label}>
                Subtítulo do relatório
                <Input value={doc.cover.subtitle} maxLength={200} disabled={!canEdit} onChange={(e) => setDoc(updateCover(doc, { subtitle: e.target.value }))} />
              </label>
              <Toggle label="Esconder capa" checked={doc.cover.hidden} onChange={(v) => setDoc(updateCover(doc, { hidden: v }))} />
              <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                <p className="text-sm font-semibold text-primary">Período de análise</p>
                <p>
                  {showDate(period.since)} a {showDate(period.until)}
                </p>
                <p>{compare ? `Comparado com ${showDate(compare.since)} a ${showDate(compare.until)}` : "Sem comparação"}</p>
                <p className="pt-1">Mudar o período lê os números de novo, o que entra com a integração das redes.</p>
              </div>
            </div>
          </PanelShell>
        )}
        {panel?.kind === "widget" && widget && <WidgetPanel w={widget} doc={doc} onChange={setDoc} onClose={() => setPanel(null)} periodKey={`${period.since}|${period.until}`} />}
        {addBlockTarget && (
          <AddPanel
            block={addBlockTarget}
            demo={doc.demo}
            onClose={() => setPanel(null)}
            onAdd={(key) => {
              const entry = addBlockTarget.network ? NETWORK_CATALOG[addBlockTarget.network]?.find((e) => e.key === key) : null;
              if (!entry) return;
              {
                const made = entry.make({ id: makeId("w"), range: period, seed: `${report.id}:${Date.now()}` });
                // A real document never gets made-up numbers: the new indicator waits, empty, for the next refresh of real data.
                setDoc(addWidgets(doc, addBlockTarget.id, [doc.demo ? made : unavailableWidget(made, "Indicador adicionado depois da geração: este relatório guarda os números do momento em que foi feito.")]));
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
          clientName={report.clientName}
          onClose={() => setNetworkAt(null)}
          onAdd={(network, account) => {
            {
              const made = demoBlock(network, account, period, `${report.id}:${network}:${doc.blocks.length}`, makeId);
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

export function AddNetworkDialog({ clientName, onClose, onAdd, demo }: { clientName: string; onClose: () => void; onAdd: (network: string, account: string) => void; demo: boolean }) {
  const [network, setNetwork] = useState<string | null>(null);
  const [account, setAccount] = useState(clientName);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar rede</DialogTitle>
        </DialogHeader>
        {!demo && <p className="text-sm text-muted-foreground">As redes entram no relatório quando a integração estiver ligada ao cliente.</p>}
        <div className="grid grid-cols-2 gap-2">
          {CATALOG_NETWORKS.map((n) => (
            <button key={n} type="button" disabled={!demo} onClick={() => setNetwork(n)} className={cn("flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm transition-colors disabled:opacity-50", network === n ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
              <NetworkIcon network={n} size={22} />
              {NETWORK_LABEL[n]}
            </button>
          ))}
        </div>
        {network && (
          <label className={label}>
            Conta
            <Input value={account} maxLength={200} onChange={(e) => setAccount(e.target.value)} />
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            <X className="mr-1.5 h-4 w-4" />
            Cancelar
          </Button>
          <Button disabled={!network || !account.trim()} onClick={() => network && onAdd(network, account.trim())}>
            <Plus className="mr-1.5 h-4 w-4" />
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
