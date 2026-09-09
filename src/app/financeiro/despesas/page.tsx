"use client";

import { ExpensesTab } from "@/components/financeiro/expenses-tab";

export default function FinanceiroDespesasPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Despesas</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Categorias, lançamentos manuais e comprovantes lidos por IA.
      </p>
      <div className="mt-6">
        <ExpensesTab />
      </div>
    </div>
  );
}
