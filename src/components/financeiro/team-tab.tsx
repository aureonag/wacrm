"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import type { FinTeamMember } from "@/lib/finance/types";

interface FormState {
  name: string;
  salary_total: string;
  payment1_label: string;
  payment1_amount: string;
  payment2_label: string;
  payment2_amount: string;
  document: string;
  phone: string;
  email: string;
}

const emptyForm: FormState = {
  name: "",
  salary_total: "",
  payment1_label: "5º dia útil",
  payment1_amount: "",
  payment2_label: "Dia 20",
  payment2_amount: "",
  document: "",
  phone: "",
  email: "",
};

/**
 * Equipe — the master payroll registry (fin_team_members). This is
 * where the full salary + 2-installment split lives; per-service-line
 * cost allocation (which line paid for how much of it) is set from
 * the Linhas de serviço tab, not here.
 */
export function TeamTab() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [members, setMembers] = useState<FinTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase.from("fin_team_members").select("*").order("name");
    setMembers((data as FinTeamMember[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchMembers();
    }
  }, [accountId, fetchMembers]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(member: FinTeamMember) {
    setEditingId(member.id);
    setForm({
      name: member.name,
      salary_total: String(member.salary_total ?? ""),
      payment1_label: member.payment1_label,
      payment1_amount: String(member.payment1_amount ?? ""),
      payment2_label: member.payment2_label,
      payment2_amount: String(member.payment2_amount ?? ""),
      document: member.document ?? "",
      phone: member.phone ?? "",
      email: member.email ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!accountId || !form.name.trim()) return;
    setSaving(true);
    const payload = {
      account_id: accountId,
      name: form.name.trim(),
      salary_total: parseFloat(form.salary_total.replace(",", ".")) || 0,
      payment1_label: form.payment1_label.trim() || "5º dia útil",
      payment1_amount: parseFloat(form.payment1_amount.replace(",", ".")) || 0,
      payment2_label: form.payment2_label.trim() || "Dia 20",
      payment2_amount: parseFloat(form.payment2_amount.replace(",", ".")) || 0,
      document: form.document.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
    };

    const { error } = editingId
      ? await supabase.from("fin_team_members").update(payload).eq("id", editingId)
      : await supabase.from("fin_team_members").insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar membro da equipe");
      return;
    }
    toast.success(editingId ? "Membro atualizado" : "Membro adicionado");
    setDialogOpen(false);
    await fetchMembers();
  }

  async function handleToggleActive(member: FinTeamMember) {
    setBusyId(member.id);
    const { error } = await supabase
      .from("fin_team_members")
      .update({ is_active: !member.is_active })
      .eq("id", member.id);
    setBusyId(null);
    if (error) {
      toast.error("Falha ao atualizar");
      return;
    }
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, is_active: !m.is_active } : m)));
  }

  async function handleDelete(member: FinTeamMember) {
    if (!confirm(`Excluir "${member.name}" do time?`)) return;
    setBusyId(member.id);
    const { error } = await supabase.from("fin_team_members").delete().eq("id", member.id);
    setBusyId(null);
    if (error) {
      toast.error("Falha ao excluir");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== member.id));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-foreground">Equipe</CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button variant="outline" size="sm" onClick={openCreate} />}>
            <Plus className="size-4" /> Adicionar
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar membro" : "Novo membro"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label>Salário total</Label>
                <Input
                  type="number"
                  value={form.salary_total}
                  onChange={(e) => setForm((f) => ({ ...f, salary_total: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>1º pagamento (rótulo)</Label>
                  <Input
                    value={form.payment1_label}
                    onChange={(e) => setForm((f) => ({ ...f, payment1_label: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>1º pagamento (valor)</Label>
                  <Input
                    type="number"
                    value={form.payment1_amount}
                    onChange={(e) => setForm((f) => ({ ...f, payment1_amount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>2º pagamento (rótulo)</Label>
                  <Input
                    value={form.payment2_label}
                    onChange={(e) => setForm((f) => ({ ...f, payment2_label: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>2º pagamento (valor)</Label>
                  <Input
                    type="number"
                    value={form.payment2_amount}
                    onChange={(e) => setForm((f) => ({ ...f, payment2_amount: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Documento</Label>
                <Input
                  value={form.document}
                  onChange={(e) => setForm((f) => ({ ...f, document: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label>Telefone</Label>
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label>E-mail</Label>
                  <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum membro cadastrado ainda.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm ${member.is_active ? "text-foreground" : "text-muted-foreground line-through"}`}>
                    {member.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(member.salary_total, "BRL")} · {member.payment1_label}{" "}
                    {formatCurrency(member.payment1_amount, "BRL")} + {member.payment2_label}{" "}
                    {formatCurrency(member.payment2_amount, "BRL")}
                  </p>
                </div>
                <Button variant="ghost" size="sm" disabled={busyId === member.id} onClick={() => handleToggleActive(member)}>
                  {member.is_active ? "Desativar" : "Ativar"}
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(member)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busyId === member.id}
                  onClick={() => handleDelete(member)}
                  className="text-muted-foreground hover:text-red-400"
                >
                  {busyId === member.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
