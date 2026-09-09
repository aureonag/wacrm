"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Check,
  Loader2,
  Paperclip,
  Plus,
  Upload,
  X,
} from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { getYearOptions } from "@/lib/finance/period";
import { MONTH_NAMES_PT } from "@/lib/finance/types";
import { MonthCell, DescriptionCell } from "@/components/financeiro/spreadsheet-cell";
import type { FinExpense, FinExpenseCategory, FinReceipt } from "@/lib/finance/types";

const selectClass =
  "h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_SHORT = MONTH_NAMES_PT.map((n) => n.slice(0, 3));

interface ReceiptDraft {
  category_id: string;
  amount: string;
  year: number;
  month: number;
  description: string;
}

function draftFromReceipt(r: FinReceipt, fallbackYear: number, fallbackMonth: number): ReceiptDraft {
  return {
    category_id: r.suggested_category_id ?? "",
    amount: r.suggested_amount != null ? String(r.suggested_amount) : "",
    year: r.suggested_year ?? fallbackYear,
    month: r.suggested_month ?? fallbackMonth,
    description: r.suggested_description ?? r.description,
  };
}

/**
 * Despesas — fixed/recurring account expenses (DAS, contabilidade,
 * prolabore etc.) as a full-year grid (one row per category, one column
 * per month — same scheme as Linhas de serviço), plus the AI-assisted
 * comprovante intake: upload a PIX/boleto proof, the account's
 * configured AI provider suggests category+amount+period, and nothing
 * is posted to `fin_expenses` until the owner reviews and confirms it.
 */
export function ExpensesTab() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [categories, setCategories] = useState<FinExpenseCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [expenses, setExpenses] = useState<FinExpense[]>([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  const [receipts, setReceipts] = useState<FinReceipt[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, ReceiptDraft>>({});
  const [busyReceiptId, setBusyReceiptId] = useState<string | null>(null);

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const ALLOWED_UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  const currentMonth = new Date().getMonth() + 1;

  function handleFileSelected(file: File | null) {
    if (!file) return;
    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      toast.error("Tipo de arquivo não suportado. Envie uma imagem (JPG/PNG/WEBP) ou PDF.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo maior que 10 MB");
      return;
    }
    setUploadFile(file);
  }

  const fetchCategories = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase.from("fin_expense_categories").select("*").order("name");
    setCategories((data as FinExpenseCategory[] | null) ?? []);
  }, [supabase, accountId]);

  const fetchExpenses = useCallback(async () => {
    if (!accountId) return;
    setLoadingExpenses(true);
    const { data } = await supabase.from("fin_expenses").select("*").eq("year", year);
    setExpenses((data as FinExpense[] | null) ?? []);
    setLoadingExpenses(false);
  }, [supabase, accountId, year]);

  const fetchReceipts = useCallback(async () => {
    setLoadingReceipts(true);
    try {
      const res = await fetch("/api/financeiro/receipts");
      const body = await res.json().catch(() => ({}));
      const rows = (body?.receipts as FinReceipt[] | undefined) ?? [];
      const pending = rows.filter((r) => r.status === "needs_review" || r.status === "failed");
      setReceipts(pending);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of pending) {
          if (!next[r.id]) next[r.id] = draftFromReceipt(r, year, currentMonth);
        }
        return next;
      });
    } finally {
      setLoadingReceipts(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  useEffect(() => {
    if (accountId) fetchCategories();
  }, [accountId, fetchCategories]);

  useEffect(() => {
    if (accountId) fetchExpenses();
  }, [accountId, fetchExpenses]);

  useEffect(() => {
    if (accountId) fetchReceipts();
  }, [accountId, fetchReceipts]);

  async function handleAddCategory() {
    if (!newCategoryName.trim() || !accountId) return;
    const { data, error } = await supabase
      .from("fin_expense_categories")
      .insert({ account_id: accountId, name: newCategoryName.trim() })
      .select()
      .single();
    if (error) {
      toast.error("Falha ao criar categoria (nome já existe?)");
      return;
    }
    setNewCategoryName("");
    setCategories((prev) => [...prev, data as FinExpenseCategory].sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function handleUpdateCategoryName(category: FinExpenseCategory, raw: string) {
    const { error } = await supabase.from("fin_expense_categories").update({ name: raw }).eq("id", category.id);
    if (error) {
      toast.error("Falha ao renomear (nome já existe?)");
      return;
    }
    setCategories((prev) =>
      prev.map((c) => (c.id === category.id ? { ...c, name: raw } : c)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async function handleDeleteCategory(category: FinExpenseCategory) {
    if (!confirm(`Excluir a categoria "${category.name}"? Isso remove os lançamentos dela.`)) return;
    const { error: expError } = await supabase.from("fin_expenses").delete().eq("category_id", category.id);
    if (expError) {
      toast.error("Falha ao excluir lançamentos da categoria");
      return;
    }
    const { error } = await supabase.from("fin_expense_categories").delete().eq("id", category.id);
    if (error) {
      toast.error("Falha ao excluir categoria");
      return;
    }
    setCategories((prev) => prev.filter((c) => c.id !== category.id));
    setExpenses((prev) => prev.filter((e) => e.category_id !== category.id));
  }

  async function handleSaveExpenseValue(categoryId: string, month: number, raw: string) {
    if (!accountId) return;
    const amount = parseFloat(raw.replace(",", ".")) || 0;
    const { data, error } = await supabase
      .from("fin_expenses")
      .upsert(
        { account_id: accountId, category_id: categoryId, year, month, amount },
        { onConflict: "category_id,year,month" },
      )
      .select()
      .single();
    if (error) {
      toast.error("Falha ao salvar valor");
      return;
    }
    const row = data as FinExpense;
    setExpenses((prev) => [...prev.filter((e) => !(e.category_id === categoryId && e.month === month)), row]);
  }

  async function handleUpload() {
    if (!uploadFile || !uploadDescription.trim()) {
      toast.error("Anexe o comprovante e escreva uma descrição");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      formData.append("description", uploadDescription.trim());
      const res = await fetch("/api/financeiro/receipts", { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Falha ao enviar comprovante");
        return;
      }
      toast.success("Comprovante enviado — revise a sugestão abaixo");
      setUploadFile(null);
      setUploadDescription("");
      await fetchReceipts();
    } finally {
      setUploading(false);
    }
  }

  async function handleConfirmReceipt(receipt: FinReceipt) {
    const draft = drafts[receipt.id];
    if (!draft?.category_id) {
      toast.error("Escolha uma categoria antes de confirmar");
      return;
    }
    const amount = parseFloat(draft.amount.replace(",", "."));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    setBusyReceiptId(receipt.id);
    try {
      const res = await fetch(`/api/financeiro/receipts/${receipt.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: draft.category_id,
          amount,
          year: draft.year,
          month: draft.month,
          description: draft.description,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Falha ao confirmar lançamento");
        return;
      }
      toast.success("Lançamento criado");
      setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
      if (draft.year === year) await fetchExpenses();
    } finally {
      setBusyReceiptId(null);
    }
  }

  async function handleRejectReceipt(receipt: FinReceipt) {
    if (!confirm("Descartar este comprovante sem criar lançamento?")) return;
    setBusyReceiptId(receipt.id);
    const { error } = await supabase
      .from("fin_receipts")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", receipt.id);
    setBusyReceiptId(null);
    if (error) {
      toast.error("Falha ao descartar");
      return;
    }
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id));
  }

  async function handleViewFile(receipt: FinReceipt) {
    const { data, error } = await supabase.storage
      .from("fin-receipts")
      .createSignedUrl(receipt.file_path, 120);
    if (error || !data?.signedUrl) {
      toast.error("Falha ao abrir o arquivo");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function updateDraft(id: string, patch: Partial<ReceiptDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const expenseByCategoryMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of expenses) map.set(`${e.category_id}:${e.month}`, e.amount);
    return map;
  }, [expenses]);
  const yearTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Enviar comprovante</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Anexe um comprovante de PIX, boleto ou similar com uma descrição — a IA sugere o valor,
            o mês e a categoria, e você confirma (ou corrige) antes de virar um lançamento.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingOver(false);
              handleFileSelected(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
              isDraggingOver ? "border-primary bg-primary/5" : "border-border bg-muted"
            }`}
          >
            <Paperclip className="size-5 text-muted-foreground" />
            <p className="text-sm text-foreground">
              {uploadFile ? uploadFile.name : "Arraste o comprovante aqui, ou clique para escolher"}
            </p>
            <p className="text-xs text-muted-foreground">JPG, PNG ou PDF · até 10 MB</p>
            <label className="absolute inset-0 cursor-pointer">
              <span className="sr-only">Escolher arquivo do comprovante</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <Textarea
            value={uploadDescription}
            onChange={(e) => setUploadDescription(e.target.value)}
            placeholder="Descrição (ex: pagamento recorrente de contabilidade referente a setembro)"
            className="bg-muted text-foreground"
          />
          <Button onClick={handleUpload} disabled={uploading || !uploadFile}>
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Enviar e ler com IA
          </Button>
        </CardContent>
      </Card>

      {(loadingReceipts ? [] : receipts).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Comprovantes para revisar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {receipts.map((receipt) => {
              const draft = drafts[receipt.id] ?? draftFromReceipt(receipt, year, currentMonth);
              const busy = busyReceiptId === receipt.id;
              return (
                <div key={receipt.id} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => handleViewFile(receipt)}
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline"
                    >
                      <Paperclip className="size-3.5" /> {receipt.file_name}
                    </button>
                    {receipt.status === "failed" && (
                      <Badge variant="destructive">
                        <AlertTriangle className="size-3" /> IA não conseguiu ler
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{receipt.description}</p>
                  {receipt.error_message && (
                    <p className="text-xs text-destructive">{receipt.error_message}</p>
                  )}
                  {receipt.ai_notes && (
                    <p className="text-xs text-muted-foreground">Observação da IA: {receipt.ai_notes}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={draft.category_id}
                      onChange={(e) => updateDraft(receipt.id, { category_id: e.target.value })}
                      className={selectClass}
                    >
                      <option value="">Categoria…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      value={draft.amount}
                      onChange={(e) => updateDraft(receipt.id, { amount: e.target.value })}
                      placeholder="Valor"
                      className="w-28 bg-muted text-foreground"
                    />
                    <select
                      value={draft.year}
                      onChange={(e) => updateDraft(receipt.id, { year: Number(e.target.value) })}
                      className={selectClass}
                    >
                      {getYearOptions().map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    <select
                      value={draft.month}
                      onChange={(e) => updateDraft(receipt.id, { month: Number(e.target.value) })}
                      className={selectClass}
                    >
                      {MONTH_NAMES_PT.map((name, i) => (
                        <option key={name} value={i + 1}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <Input
                      value={draft.description}
                      onChange={(e) => updateDraft(receipt.id, { description: e.target.value })}
                      placeholder="Descrição do lançamento"
                      className="min-w-[180px] flex-1 bg-muted text-foreground"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => handleConfirmReceipt(receipt)} disabled={busy}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      Confirmar lançamento
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRejectReceipt(receipt)}
                      disabled={busy}
                      className="text-muted-foreground hover:text-red-400"
                    >
                      <X className="size-4" /> Descartar
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Categorias de despesa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <Badge key={c.id} variant="outline" className="gap-1.5 pr-1">
                {c.name}
                <button type="button" onClick={() => handleDeleteCategory(c)} className="hover:text-red-400">
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
            {categories.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria ainda.</p>}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
              placeholder="Nova categoria (ex: Contabilidade)"
              className="max-w-xs bg-muted text-foreground"
            />
            <Button variant="outline" size="sm" onClick={handleAddCategory} disabled={!newCategoryName.trim()}>
              <Plus className="size-4" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-foreground">Lançamentos</CardTitle>
          <div className="flex items-center gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectClass}>
              {getYearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Badge variant="outline">Total no ano: {formatCurrency(yearTotal, "BRL")}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loadingExpenses ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">Cadastre uma categoria de despesa acima para começar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 z-10 min-w-[210px] bg-card">Categoria</TableHead>
                  {MONTH_SHORT.map((m) => (
                    <TableHead key={m} className="text-right">
                      {m}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell className="sticky left-0 z-10 bg-card p-0.5">
                      <DescriptionCell
                        value={category.name}
                        resetKey={`${category.id}-${category.name}`}
                        onSave={(raw) => handleUpdateCategoryName(category, raw)}
                      />
                    </TableCell>
                    {MONTHS.map((m) => (
                      <TableCell key={m} className="p-0.5 text-right">
                        <MonthCell
                          value={expenseByCategoryMonth.get(`${category.id}:${m}`)}
                          resetKey={`${category.id}-${year}-${m}-${expenseByCategoryMonth.get(`${category.id}:${m}`) ?? "e"}`}
                          onSave={(raw) => handleSaveExpenseValue(category.id, m, raw)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
