"use client";

// One dashboard of a client (Reportei's /dashboard/v4/<id>): loads it and hands it to the editor.

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import { useHasPermission } from "@/hooks/use-permissions";
import { DashboardDocEditor, type EditorDashboard } from "../../../../_components/dashboard-doc-editor";

type State = { kind: "loading" } | { kind: "error" } | { kind: "notFound" } | { kind: "ready"; dashboard: EditorDashboard };

export default function ReporteiClientDashboardPage({ params }: { params: Promise<{ clientId: string; dashboardId: string }> }) {
  const { clientId, dashboardId } = use(params);
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetch(`/api/operational/reportei/client-dashboards/${dashboardId}`)
      .then(async (res) => {
        if (!alive) return;
        if (res.status === 404) return setState({ kind: "notFound" });
        if (!res.ok) return setState({ kind: "error" });
        setState({ kind: "ready", dashboard: ((await res.json()) as { dashboard: EditorDashboard }).dashboard });
      })
      .catch(() => alive && setState({ kind: "error" }));
    return () => {
      alive = false;
    };
  }, [dashboardId]);

  if (state.kind === "loading") return <Skeleton className="h-96" />;
  if (state.kind !== "ready") {
    return (
      <>
        <Link href={`/operational/reportei/clientes/${clientId}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </Link>
        <EmptyState title={state.kind === "notFound" ? "Esse dashboard não existe mais." : "Não foi possível carregar o dashboard."} className="min-h-40" />
      </>
    );
  }
  return <DashboardDocEditor dashboard={state.dashboard} canEdit={canEdit} />;
}
