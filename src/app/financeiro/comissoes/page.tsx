"use client";

import { CommissionsTab } from "@/components/financeiro/commissions-tab";

export default function FinanceiroComissoesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Comissões</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Quanto pagar de comissão, para quem e em que dia, e o total pago mês a mês.
      </p>
      <div className="mt-6">
        <CommissionsTab />
      </div>
    </div>
  );
}
