"use client";

import { Wallet } from "lucide-react";
import { OverviewTab } from "@/components/financeiro/overview-tab";

export default function FinanceiroDashboardPage() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Wallet className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Financeiro</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Acompanhamento financeiro privado — visível apenas para o proprietário da conta.
      </p>
      <div className="mt-6">
        <OverviewTab />
      </div>
    </div>
  );
}
