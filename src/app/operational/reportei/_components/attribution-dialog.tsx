"use client";

// Which attribution windows Meta is asked to use for the conversions of one linked account.
// "Padrão da Meta" asks for nothing special; the other choices pin the windows. What Meta says
// it applied is shown in the reports, next to the events that counted.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const PRESETS: { label: string; windows: string[] | null }[] = [
  { label: "Padrão da Meta (não pedir nada)", windows: null },
  { label: "7 dias após o clique", windows: ["7d_click"] },
  { label: "7 dias após o clique + 1 dia após a visualização", windows: ["7d_click", "1d_view"] },
  { label: "1 dia após o clique", windows: ["1d_click"] },
  { label: "1 dia após o clique + 1 dia após a visualização", windows: ["1d_click", "1d_view"] },
  { label: "28 dias após o clique", windows: ["28d_click"] },
];

const keyOf = (w: string[] | null) => (w ? w.join("+") : "");

export function AttributionDialog({ clientId, integrationId, accountName, onClose }: { clientId: string; integrationId: string; accountName: string; onClose: () => void }) {
  const [value, setValue] = useState<string | null>(null); // null = loading
  const [available, setAvailable] = useState(true);
  const [custom, setCustom] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const base = `/api/operational/reportei/clients/${clientId}/integrations/${integrationId}/attribution`;

  useEffect(() => {
    let alive = true;
    fetch(base)
      .then(async (res) => {
        if (!alive || !res.ok) return;
        const body = (await res.json()) as { windows: string[] | null; available: boolean };
        setAvailable(body.available);
        if (body.windows && !PRESETS.some((p) => keyOf(p.windows) === keyOf(body.windows))) setCustom(body.windows);
        setValue(keyOf(body.windows));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, [base]);

  const options = custom ? [...PRESETS, { label: `Outra: ${custom.join(", ")}`, windows: custom }] : PRESETS;

  async function save() {
    const chosen = options.find((o) => keyOf(o.windows) === value);
    if (!chosen) return;
    setSaving(true);
    try {
      const res = await fetch(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ windows: chosen.windows }) });
      if (res.status === 503) return toast.error("Ainda não dá para salvar: falta aplicar uma atualização no banco.");
      if (!res.ok) return toast.error("Não foi possível salvar a atribuição.");
      toast.success("Atribuição salva. Vale para os próximos relatórios e dashboards.");
      onClose();
    } catch {
      toast.error("Não foi possível salvar a atribuição.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Atribuição de {accountName}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Define em quanto tempo depois do clique ou da visualização a Meta pode atribuir uma compra ou um lead ao anúncio. Mudar isso muda os números de conversão.</p>
        {value === null ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-2" role="radiogroup" aria-label="Janelas de atribuição">
            {options.map((o) => (
              <label key={keyOf(o.windows)} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <input type="radio" name="attribution" checked={value === keyOf(o.windows)} disabled={!available} onChange={() => setValue(keyOf(o.windows))} />
                {o.label}
              </label>
            ))}
            {!available && <p className="text-xs text-amber-500">Disponível depois de aplicar a atualização do banco.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" disabled={saving || !available || value === null} onClick={() => void save()}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
