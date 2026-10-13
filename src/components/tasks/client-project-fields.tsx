"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { SearchableSelect } from "@/components/ui/searchable-select";

// Cliente -> Projeto of a task. The clients are the ACTIVE ones of
// Operacional -> Clientes (not the CRM's contact list) and the projects are the
// ones of the chosen client. A task is stored with its project only (the project
// knows its client), so choosing a client without projects cannot be saved: the
// field says so and points to where projects are created.

export interface ClientProjectFieldProps {
  label: string;
  icon: "client" | "project";
  children: React.ReactNode;
}

interface ClientOption {
  id: string;
  name: string;
  code: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
  client_id: string;
}

interface Props {
  projectId: string | null;
  onChange: (projectId: string | null) => void;
  /** Reports the chosen client's name (for the task assistant). */
  onClientName?: (name: string | null) => void;
  disabled?: boolean;
  /** Lays one field out (the dialog and the task panel draw them differently). */
  Field: React.ComponentType<ClientProjectFieldProps>;
}

const NONE = "__none";
const clientLabel = (c: ClientOption) => `${c.code ? `${c.code} · ` : ""}${c.name}`;

export function ClientProjectFields({ projectId, onChange, onClientName, disabled, Field }: Props) {
  const t = useTranslations("Operational.clientProject");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  // The saved project may be archived or of an inactive client: not in the lists above.
  const [saved, setSaved] = useState<{ project: ProjectOption; client: ClientOption } | null>(null);
  // What the person picked in the client box (overrides what the project implies).
  const [pickedClient, setPickedClient] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        fetch("/api/operational/ops-clients?status=active").catch(() => null),
        fetch("/api/operational/ops-projects").catch(() => null),
      ]);
      if (cancelled) return;
      if (c?.ok) setClients(((await c.json()) as { clients: ClientOption[] }).clients);
      if (p?.ok) {
        setProjects(
          ((await p.json()) as { projects: ProjectOption[] }).projects.map((x) => ({ id: x.id, name: x.name, client_id: x.client_id })),
        );
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !projectId || projects.some((p) => p.id === projectId) || saved?.project.id === projectId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/operational/ops-projects/${projectId}`).catch(() => null);
      if (!res?.ok || cancelled) return;
      const data = (await res.json()) as {
        project: { id: string; name: string };
        client: { id: string; name: string; code: string | null } | null;
      };
      if (!data.client || cancelled) return;
      setSaved({
        project: { id: data.project.id, name: data.project.name, client_id: data.client.id },
        client: { id: data.client.id, name: data.client.name, code: data.client.code },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, projectId, projects, saved]);

  const allClients = useMemo(
    () => (saved && !clients.some((c) => c.id === saved.client.id) ? [...clients, saved.client] : clients),
    [clients, saved],
  );
  const allProjects = useMemo(
    () => (saved && !projects.some((p) => p.id === saved.project.id) ? [...projects, saved.project] : projects),
    [projects, saved],
  );

  const projectClientId = projectId ? (allProjects.find((p) => p.id === projectId)?.client_id ?? null) : null;
  const clientId = pickedClient ?? projectClientId;
  const clientProjects = clientId ? allProjects.filter((p) => p.client_id === clientId) : [];
  const clientName = clientId ? (allClients.find((c) => c.id === clientId)?.name ?? null) : null;

  useEffect(() => {
    onClientName?.(clientName);
  }, [clientName, onClientName]);

  const sortedClients = useMemo(
    () => [...allClients].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [allClients],
  );

  return (
    <>
      <Field label={t("client")} icon="client">
        <SearchableSelect
          value={clientId ?? NONE}
          disabled={disabled}
          onChange={(v) => {
            const next = v === NONE ? null : v;
            setPickedClient(next);
            // A project of another client no longer applies.
            if (projectId && projectClientId !== next) onChange(null);
          }}
          noneOption={{ value: NONE, label: t("noClient") }}
          options={sortedClients.map((c) => ({ value: c.id, label: clientLabel(c) }))}
          placeholder={t("noClient")}
          searchPlaceholder={t("searchClient")}
          emptyLabel={t("noResults")}
        />
      </Field>

      <Field label={t("project")} icon="project">
        <SearchableSelect
          value={projectId ?? NONE}
          disabled={disabled || !clientId || clientProjects.length === 0}
          onChange={(v) => onChange(v === NONE ? null : v)}
          noneOption={{ value: NONE, label: t("noProject") }}
          options={clientProjects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder={
            clientId ? (clientProjects.length === 0 ? t("noProjects") : t("pickProject")) : t("pickClientFirst")
          }
          searchPlaceholder={t("searchProject")}
          emptyLabel={t("noResults")}
        />
        {clientId && clientProjects.length === 0 && loaded && (
          <p className="mt-1 text-[11px] text-amber-500">
            {t("noProjectsHint")}{" "}
            <Link href={`/operational/clients/${clientId}`} className="underline" target="_blank" rel="noreferrer">
              {t("openClient")}
            </Link>
          </p>
        )}
      </Field>
    </>
  );
}
