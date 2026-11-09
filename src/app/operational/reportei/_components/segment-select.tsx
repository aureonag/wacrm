"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useHasPermission } from "@/hooks/use-permissions";
import { LEAD_EVENT_OPTIONS, PURCHASE_EVENT_OPTIONS } from "@/lib/reportei/event-config";
import { SEGMENT_LABEL, type Segment } from "@/lib/reportei/overview";

const CHANGED = "reportei:client-type-changed";
const OPTIONS: Segment[] = ["leads", "ecommerce", "mixed"];
const HINTS: Record<Segment, string> = { leads: "Leads e custo por lead", ecommerce: "Compras, receita e ROAS", mixed: "Leads e vendas no mesmo cliente" };

/** One saved client classification, reused in the permanent card and Meta picker. */
export function SegmentSelect({ clientId, compact = false, onBusyChange }: { clientId: string; compact?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const id = useId();
  const [segment, setSegment] = useState<Segment | "">("");
  const [leadEvent, setLeadEvent] = useState("");
  const [purchaseEvent, setPurchaseEvent] = useState("");
  const [available, setAvailable] = useState(true);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/operational/reportei/clients/${clientId}/segment`);
        if (!res.ok) throw new Error("load");
        const body = await res.json();
        if (!alive) return;
        setSegment(body.segment ?? "");
        setLeadEvent(body.leadEvent ?? "");
        setPurchaseEvent(body.purchaseEvent ?? "");
        setAvailable(body.available === true);
        setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();
    const sync = (event: Event) => {
      const changed = (event as CustomEvent<{ clientId: string; segment: Segment }>).detail;
      if (changed?.clientId === clientId) setSegment(changed.segment);
    };
    window.addEventListener(CHANGED, sync);
    return () => { alive = false; window.removeEventListener(CHANGED, sync); };
  }, [clientId, retry]);

  async function save(patch: { segment?: Segment; leadEvent?: string | null; purchaseEvent?: string | null }, done: () => void, label: string) {
    if (saving) return;
    setSaving(true);
    onBusyChange?.(true);
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/segment`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!res.ok) return toast.error(`Não foi possível salvar ${label}. Tente novamente.`);
      done();
      if (patch.segment) window.dispatchEvent(new CustomEvent(CHANGED, { detail: { clientId, segment: patch.segment } }));
      toast.success(`${label === "o tipo do cliente" ? "Tipo do cliente" : "Evento"} salvo.`);
    } catch {
      toast.error(`Não foi possível salvar ${label}. Tente novamente.`);
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }

  const eventSelect = (label: string, value: string, options: readonly string[], onPick: (v: string) => void) => (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select value={value || "__default__"} disabled={!canEdit || saving || !available} onValueChange={(next) => { if (next) onPick(next === "__default__" ? "" : String(next)); }}>
        <SelectTrigger aria-label={label} className="w-full"><SelectValue>{value || `Padrão (${options[0]})`}</SelectValue></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="__default__">Padrão ({options[0]})</SelectItem>
          {(value && !options.includes(value) ? [...options, value] : options).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
    </label>
  );

  return (
    <Card size={compact ? "sm" : "default"} aria-label="Tipo de resultado do cliente">
      <CardHeader>
        <CardTitle>Tipo de resultado do cliente</CardTitle>
        <CardDescription>{compact ? "Escolha o foco deste cliente. A escolha fica salva mesmo depois de conectar." : "Defina o foco dos resultados. Você pode mudar quando quiser, sem reconectar as contas."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status === "loading" && <p role="status" className="text-sm text-muted-foreground">Carregando tipo do cliente…</p>}
        {status === "error" && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><span>Não foi possível carregar o tipo do cliente.</span><Button variant="outline" size="sm" onClick={() => { setStatus("loading"); setRetry((n) => n + 1); }}>Tentar novamente</Button></div>}
        {status === "ready" && <>
          <RadioGroup aria-label="Tipo do cliente" value={segment} disabled={!canEdit || saving || !available} onValueChange={(value) => {
            if (OPTIONS.includes(value as Segment) && value !== segment) void save({ segment: value as Segment }, () => setSegment(value as Segment), "o tipo do cliente");
          }} className="grid gap-2 sm:grid-cols-3">
            {OPTIONS.map((value) => <label key={value} htmlFor={`${id}-${value}`} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 has-[[data-checked]]:border-primary has-[[data-checked]]:bg-muted has-[:disabled]:cursor-not-allowed">
              <RadioGroupItem id={`${id}-${value}`} value={value} />
              <span className="flex min-w-0 flex-col gap-1"><span className="text-sm font-medium">{SEGMENT_LABEL[value]}</span>{!compact && <span className="text-xs text-muted-foreground">{HINTS[value]}</span>}</span>
            </label>)}
          </RadioGroup>
          {!available && <p role="alert" className="text-xs text-muted-foreground">A configuração está temporariamente indisponível.</p>}
          {available && !segment && <p className="text-xs text-muted-foreground">Ainda não definido. Se atuar com captação e vendas, selecione Misto.</p>}
          {!canEdit && <p className="text-xs text-muted-foreground">Seu acesso permite consultar. Peça a um responsável para alterar.</p>}
          {saving && <p role="status" className="text-xs text-muted-foreground">Salvando…</p>}
          {!compact && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Configurações avançadas dos eventos da Meta</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
            {eventSelect("Evento de lead", leadEvent, LEAD_EVENT_OPTIONS, (v) => void save({ leadEvent: v || null }, () => setLeadEvent(v), "o evento de lead"))}
            {eventSelect("Evento de compra", purchaseEvent, PURCHASE_EVENT_OPTIONS, (v) => void save({ purchaseEvent: v || null }, () => setPurchaseEvent(v), "o evento de compra"))}
          </div></details>}
        </>}
      </CardContent>
    </Card>
  );
}
