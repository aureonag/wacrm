"use client";

import { TeamTab } from "@/components/financeiro/team-tab";

export default function FinanceiroEquipePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Equipe</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Registro mestre da folha de pagamento — salário e parcelas de cada pessoa.
      </p>
      <div className="mt-6">
        <TeamTab />
      </div>
    </div>
  );
}
