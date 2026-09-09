"use client";

import { ServiceLinesTab } from "@/components/financeiro/service-lines-tab";

export default function FinanceiroLinhasPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Linhas de serviço</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Clientes recorrentes e custo de time/freela por linha, mês a mês.
      </p>
      <div className="mt-6">
        <ServiceLinesTab />
      </div>
    </div>
  );
}
