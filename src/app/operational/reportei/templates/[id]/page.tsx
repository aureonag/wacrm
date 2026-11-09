"use client";

// One template on its own screen: the whole template laid out as a report, with
// made-up numbers, so it can be seen before it is used. "Usar este template" goes to
// the clients to start a report; the saved ones can also be renamed or removed.

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/dashboard/skeleton";
import { DocBody } from "@/components/reportei/report-doc-view";
import { useHasPermission } from "@/hooks/use-permissions";
import { makeId } from "@/lib/reportei/doc";
import { demoSource } from "@/lib/reportei/doc-catalog";
import { buildDocFromTemplate } from "@/lib/reportei/doc-templates";
import { showDate } from "@/lib/reportei/format";
import { resolvePeriod } from "@/lib/reportei/periods";
import { resolveWizardPeriod } from "@/lib/reportei/wizard";
import { EditTemplateDialog } from "../../_components/edit-template-dialog";
import { usePickerTemplates } from "../../_components/template-picker";

const backClass = "inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground";

export default function TemplateScreen({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = decodeURIComponent(raw);
  const router = useRouter();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const { items, reload } = usePickerTemplates();
  const [editing, setEditing] = useState(false);
  const template = items?.find((t) => t.id === id) ?? null;
  const editable = !!template && template.group !== "reportei";

  const range = useMemo(() => resolveWizardPeriod("last_30d", resolvePeriod("last_7d").until), []);
  const doc = useMemo(() => {
    if (!template?.layout) return null;
    const networks = [...new Set([...template.layout.blocks.map((b) => b.network), ...template.layout.custom.flatMap((c) => c.networks)])];
    return buildDocFromTemplate({ layout: template.layout, integrations: networks.map((n) => ({ network: n, account: "Conta de exemplo" })), range, seed: id, source: demoSource }, makeId);
  }, [template, range, id]);

  async function remove() {
    if (!template || !window.confirm(`Apagar o template "${template.name}"? Relatórios já gerados não mudam.`)) return;
    const res = await fetch(`/api/operational/reportei/templates/${template.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return toast.error("Não foi possível apagar o template.");
    toast.success("Template apagado.");
    router.push("/operational/reportei/templates");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/operational/reportei/templates" className={backClass}>
            <ArrowLeft className="h-4 w-4" />
            Voltar para os templates
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-foreground">{template?.name ?? "Template"}</h1>
          {template?.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{template.description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {editable && canEdit && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Editar
              </Button>
              <Button variant="outline" size="sm" className="text-red-600 hover:text-red-600" onClick={() => void remove()}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Apagar
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => router.push("/operational/reportei/clientes")}>
            Usar este template
          </Button>
        </div>
      </div>

      {items === null ? (
        <Skeleton className="h-96" />
      ) : !template ? (
        <p className="text-sm text-muted-foreground">Esse template não existe mais.</p>
      ) : !doc ? (
        <p className="text-sm text-muted-foreground">Este template é do modelo antigo (só escolhe métricas) e não tem blocos para mostrar.</p>
      ) : (
        <>
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Exemplo com números fictícios. Ao gerar um relatório, os números vêm das integrações do cliente.
          </p>
          <DocBody doc={doc} title={template.name} clientName="Cliente de exemplo" logoUrl={null} generatedText={`Relatório gerado dos dados analisados entre ${showDate(range.since)} e ${showDate(range.until)}.`} editable={false} />
        </>
      )}

      {editing && template && (
        <EditTemplateDialog
          template={template}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
