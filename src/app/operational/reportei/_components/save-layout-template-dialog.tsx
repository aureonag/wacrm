"use client";

// "Salvar como template" of a report made as a document: keeps which networks and
// indicators it has (never the numbers) as a template of "Meus templates".

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateLayout } from "@/lib/reportei/doc-templates";
import { NAME_MAX } from "@/lib/reportei/template";

export function SaveLayoutTemplateDialog({ layout, defaultName, onClose, onSaved }: { layout: TemplateLayout; defaultName: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(defaultName.slice(0, NAME_MAX));
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/operational/reportei/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description, layout }),
      });
      if (!res.ok) return toast.error("Não foi possível salvar o template.");
      onSaved();
    } catch {
      toast.error("Não foi possível salvar o template.");
    } finally {
      setSaving(false);
    }
  }

  const count = layout.blocks.reduce((s, b) => s + b.keys.length, 0) + layout.custom.length;

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Salvar como template</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          O template guarda as {layout.blocks.length} redes e os {count} indicadores deste relatório, e não os números. Ele aparece em &quot;Meus templates&quot; ao criar um relatório.
        </p>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Nome</span>
          <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Descrição (opcional)</span>
          <Textarea value={description} maxLength={500} rows={3} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={saving || !name.trim() || count === 0} onClick={save}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
