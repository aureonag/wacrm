"use client";

// "Tipo do cliente": what the client sells (geração de leads, e-commerce or both). The
// general dashboard judges each client by the results of its type, so it is set by a
// person; "Não configurado" keeps the client out of highlights and attention.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useHasPermission } from "@/hooks/use-permissions";
import { LEAD_EVENT_OPTIONS, PURCHASE_EVENT_OPTIONS } from "@/lib/reportei/event-config";
import { SEGMENT_LABEL, type Segment } from "@/lib/reportei/overview";

const OPTIONS: { value: Segment | ""; label: string }[] = [{ value: "", label: "Não configurado" }, ...(Object.keys(SEGMENT_LABEL) as Segment[]).map((s) => ({ value: s, label: SEGMENT_LABEL[s] }))];

export function SegmentSelect({ clientId }: { clientId: string }) {
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [segment, setSegment] = useState<Segment | "">("");
  const [leadEvent, setLeadEvent] = useState("");
  const [purchaseEvent, setPurchaseEvent] = useState("");
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/operational/reportei/clients/${clientId}/segment`)
      .then(async (res) => {
        if (!alive || !res.ok) return;
        const body = (await res.json()) as { segment: Segment | null; leadEvent?: string | null; purchaseEvent?: string | null; available: boolean };
        setSegment(body.segment ?? "");
        setLeadEvent(body.leadEvent ?? "");
        setPurchaseEvent(body.purchaseEvent ?? "");
        setAvailable(body.available);
        setLoaded(true);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [clientId]);

  async function save(patch: { segment?: Segment | null; leadEvent?: string | null; purchaseEvent?: string | null }, done: () => void, what: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/clients/${clientId}/segment`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (res.status === 503) return toast.error("Ainda não dá para salvar: falta aplicar uma atualização no banco.");
      if (!res.ok) return toast.error(`Não foi possível salvar ${what}.`);
      done();
      toast.success(`${what[0].toUpperCase()}${what.slice(1)} salvo.`);
    } catch {
      toast.error(`Não foi possível salvar ${what}.`);
    } finally {
      setSaving(false);
    }
  }
  const change = (next: Segment | "") => save({ segment: next || null }, () => setSegment(next), "o tipo do cliente");

  if (!loaded) return null;
  const eventSelect = (label: string, value: string, options: readonly string[], onPick: (v: string) => void, title: string) => (
    <label className="flex items-center gap-2 text-xs text-muted-foreground" title={title}>
      {label}
      <select
        value={value}
        disabled={!canEdit || saving || !available}
        onChange={(e) => onPick(e.target.value)}
        className="h-8 max-w-[16rem] rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30"
      >
        <option value="">Padrão ({options[0]})</option>
        {(value && !options.includes(value) ? [...options, value] : options).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
    <label className="flex items-center gap-2 text-xs text-muted-foreground" title={available ? "Define quais resultados avaliam este cliente no dashboard geral." : "Disponível depois de aplicar a atualização do banco."}>
      Tipo do cliente
      <select
        value={segment}
        disabled={!canEdit || saving || !available}
        onChange={(e) => void change(e.target.value as Segment | "")}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
    {eventSelect("Evento de lead", leadEvent, LEAD_EVENT_OPTIONS, (v) => void save({ leadEvent: v || null }, () => setLeadEvent(v), "o evento de lead"), "O evento da Meta que conta os leads deste cliente. Só ele é usado, sem somar outros.")}
    {eventSelect("Evento de compra", purchaseEvent, PURCHASE_EVENT_OPTIONS, (v) => void save({ purchaseEvent: v || null }, () => setPurchaseEvent(v), "o evento de compra"), "O evento da Meta que conta as compras e o valor deste cliente. A quantidade e o valor vêm sempre do mesmo evento.")}
    </div>
  );
}
