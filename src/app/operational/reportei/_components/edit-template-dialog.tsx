"use client";

// Rename / describe one of the saved templates (experts and Meus templates).

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NAME_MAX } from "@/lib/reportei/template";
import type { PickerTemplate } from "./template-picker";

export function EditTemplateDialog({ template, onClose, onSaved }: { template: PickerTemplate; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/operational/reportei/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description }),
      });
      if (!res.ok) return toast.error("Não foi possível salvar o template.");
      toast.success("Template salvo.");
      onSaved();
    } catch {
      toast.error("Não foi possível salvar o template.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar template</DialogTitle>
        </DialogHeader>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Nome</span>
          <Input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="font-medium text-foreground">Descrição</span>
          <Textarea value={description} maxLength={500} rows={4} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={saving || !name.trim()} onClick={save}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
