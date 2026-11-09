"use client";

// Operacional → Reportei → Templates: the same list shown when a report is started
// (Reportei's four, the experts' and Meus templates). Clicking one opens its own
// screen (templates/[id]) with the whole template laid out as a report.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TemplatePicker, usePickerTemplates } from "../_components/template-picker";

export default function ReporteiTemplatesPage() {
  const router = useRouter();
  const { items, failed } = usePickerTemplates();
  const [usage, setUsage] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/operational/reportei/templates/usage")
      .then((res) => (res.ok ? res.json() : null))
      .then((j: { usage: Record<string, number> } | null) => j && setUsage(j.usage))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/operational/reportei/clientes"))}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para a geração do relatório
        </button>
        <h1 className="text-2xl font-bold text-foreground">Templates</h1>
      </div>

      {failed && <p className="text-sm text-red-500">Não foi possível carregar os templates.</p>}

      <TemplatePicker items={items} usage={usage} value={null} onChange={(id) => router.push(`/operational/reportei/templates/${encodeURIComponent(id)}`)} />
    </div>
  );
}
