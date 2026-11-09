"use client";

// The home of one Reportei client, laid out as cards like Reportei's: the latest
// reports, the live dashboard, the goals, the marketing timeline and the
// automation, each with its own "new" and "see all" buttons. No AI anywhere:
// everything here is read from the CRM or from Meta, never interpreted.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertTriangle, CalendarDays, Check, Clock, FileText, Flag, LayoutDashboard, Plug, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/hooks/use-permissions";
import { daysBetween, defaultAnalysisPeriod, nextScheduledDay, type AnalysisPeriod, type Frequency } from "@/lib/reportei/automation";
import { demoNetworks } from "@/lib/reportei/client-card";
import { showDate } from "@/lib/reportei/format";
import type { Goals } from "@/lib/reportei/goals";
import { INTEGRATION_CATALOG } from "@/lib/reportei/integrations-catalog";
import { resolvePeriod } from "@/lib/reportei/periods";
import type { TimelineEvent } from "@/lib/reportei/timeline";
import { cn } from "@/lib/utils";
import { NetworkIcon } from "./network-icon";

export type HomeView = "integrations" | "reports" | "automations" | "timeline";

interface SavedReport {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  auto: boolean;
  networks: string[];
}

interface AutomationSummary {
  frequency: Frequency;
  active: boolean;
  analysisPeriod: AnalysisPeriod | null;
  reportTitle: string | null;
  lastRunOn: string | null;
  lastError: string | null;
  lastReport: { id: string; title: string } | null;
}

// Local-only preview, same switch as the clients grid: made-up networks on the header.
const DEMO_ICONS = process.env.NEXT_PUBLIC_REPORTEI_DEMO_ICONS === "1";
const CATALOG_KEYS = INTEGRATION_CATALOG.map((c) => c.key);
const NETWORK_NAME = new Map(INTEGRATION_CATALOG.map((c) => [c.key, c.name]));

const TINT = {
  green: "bg-emerald-500 text-emerald-600",
  sky: "bg-sky-500 text-sky-600",
  blue: "bg-blue-600 text-blue-600",
  purple: "bg-purple-500 text-purple-600",
  orange: "bg-orange-500 text-orange-600",
} as const;
type Tint = keyof typeof TINT;

function HomeCard({
  icon: Icon,
  tint,
  title,
  children,
  primary,
  secondary,
}: {
  icon: typeof FileText;
  tint: Tint;
  title: string;
  children: React.ReactNode;
  primary?: { label: string; onClick?: () => void; href?: string };
  secondary?: { label: string; onClick?: () => void; href?: string };
}) {
  const [bg, text] = TINT[tint].split(" ");
  const action = (a: { label: string; onClick?: () => void; href?: string }, className: string) =>
    a.href ? (
      <Link href={a.href} className={className}>
        {a.label}
      </Link>
    ) : (
      <button type="button" onClick={a.onClick} className={className}>
        {a.label}
      </button>
    );
  const foot = "flex items-center justify-center bg-card px-3 py-3.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted/50";

  return (
    <section className="flex min-h-[22rem] flex-col">
      <div className="flex flex-1 flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-sm">
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl text-white", bg)}>
            <Icon className="h-5 w-5" />
          </span>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        </header>
        <div className="flex-1 space-y-1 px-5 py-3">{children}</div>
      </div>
      <div className="mt-px grid grid-cols-[1.2fr_1fr] gap-px overflow-hidden rounded-b-2xl border border-t-0 border-border bg-border">
        {primary ? action(primary, cn(foot, text)) : <span className={foot} />}
        {secondary ? action(secondary, cn(foot, "text-muted-foreground")) : <span className={foot} />}
      </div>
    </section>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <div className="border-b border-border/70 py-3 last:border-0">{children}</div>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;

export function ClientHome({
  clientId,
  clientName,
  providers,
  onGo,
}: {
  clientId: string;
  clientName: string;
  /** Networks with a linked account (real ones). */
  providers: string[];
  onGo: (view: HomeView) => void;
}) {
  const t = useTranslations("Operational.reportei.clientHome");
  const tp = useTranslations("Operational.reportei.automationsPanel");
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [automation, setAutomation] = useState<AutomationSummary | null | undefined>(undefined);
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [goals, setGoals] = useState<Goals | null>(null);
  const [dashboards, setDashboards] = useState<{ id: string; title: string; networks: string[]; updatedAt: string }[] | null>(null);
  const [creatingDash, setCreatingDash] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const get = <T,>(path: string, then: (body: T) => void) =>
      fetch(`/api/operational/reportei/${path}`)
        .then(async (res) => alive && res.ok && then((await res.json()) as T))
        .catch(() => undefined);
    void get<{ reports: SavedReport[] }>(`reports?clientId=${clientId}`, (b) => setReports(b.reports));
    void get<{ automation: AutomationSummary | null }>(`clients/${clientId}/automation`, (b) => setAutomation(b.automation));
    void get<{ events: TimelineEvent[] }>(`clients/${clientId}/timeline`, (b) => setEvents(b.events));
    void get<{ goals: Goals }>(`clients/${clientId}/goals`, (b) => setGoals(b.goals));
    void get<{ dashboards: { id: string; title: string; networks: string[]; updatedAt: string }[] }>(`client-dashboards?clientId=${clientId}`, (b) => setDashboards(b.dashboards));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const networks = DEMO_ICONS ? demoNetworks(clientName, CATALOG_KEYS) : [...new Set(providers)];
  const hasIntegrations = DEMO_ICONS || providers.length > 0;
  const today = resolvePeriod("last_7d").until;
  const dashboardHref = `/operational/reportei/dashboards/${clientId}`;

  // "+ Novo dashboard": the Padrão layout filled with the real numbers of the client's Meta Ads
  // accounts, opened right away. Without a linked account nothing is made up: the person is
  // asked whether to make a marked model with fictitious numbers instead.
  async function createDashboard(demo = false) {
    if (creatingDash) return;
    setCreatingDash(true);
    try {
      const res = await fetch("/api/operational/reportei/client-dashboards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, integrations: networks.map((n) => ({ network: n, account: clientName })), ...(demo ? { demo: true } : {}) }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        if (err?.error === "no_integration" && !demo) {
          setCreatingDash(false);
          if (window.confirm("Este cliente não tem conta de anúncios integrada, então não há números reais. Criar um modelo com números fictícios, marcado como modelo?")) void createDashboard(true);
          return;
        }
        if (err?.error === "unreadable") return toast.error("Não foi possível ler a Meta agora. Nenhum dashboard foi criado.");
        return toast.error("Não foi possível criar o dashboard.");
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/operational/reportei/dashboards/${clientId}/v4/${id}`);
    } catch {
      toast.error("Não foi possível criar o dashboard.");
    } finally {
      setCreatingDash(false);
    }
  }

  const nextRun = automation ? daysBetween(today, nextScheduledDay(automation.frequency, today)) : null;
  const lower = (s: string) => s.charAt(0).toLocaleLowerCase("pt-BR") + s.slice(1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex -space-x-1.5">
          {networks.map((n) => (
            <span key={n} title={NETWORK_NAME.get(n) ?? n} className="flex h-8 w-8 items-center justify-center rounded-full bg-card shadow ring-2 ring-card">
              <NetworkIcon network={n} size={20} />
            </span>
          ))}
        </span>
        <Button variant="outline" onClick={() => onGo("integrations")} className="rounded-full border-primary text-primary hover:bg-primary/5">
          <Plug className="mr-1.5 h-4 w-4" />
          {t("manageIntegrations")}
        </Button>
        {!hasIntegrations && <span className="text-sm text-muted-foreground">{t("noIntegrations")}</span>}
      </div>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <HomeCard
          icon={FileText}
          tint="green"
          title={t("reports")}
          primary={canEdit ? { label: `+ ${t("newReport")}`, href: `/operational/reportei/clientes/${clientId}/relatorios/novo` } : undefined}
          secondary={{ label: t("seeAll", { count: reports?.length ?? 0 }), onClick: () => onGo("reports") }}
        >
          {reports === null ? (
            <Empty>…</Empty>
          ) : reports.length === 0 ? (
            <Empty>{t("reportsEmpty")}</Empty>
          ) : (
            reports.slice(0, 3).map((r) => (
              <Row key={r.id}>
                <Link href={`/operational/reportei/relatorios/${r.id}`} className="block space-y-1 hover:opacity-80">
                  <span className="flex items-center gap-1.5">
                    {(r.networks?.length ? r.networks : ["meta_ads"]).map((n) => (
                      <NetworkIcon key={n} network={n} size={16} />
                    ))}
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {r.auto && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t("auto")}</span>}
                  </span>
                  <span className="block truncate text-sm font-medium text-foreground">{r.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {showDate(r.periodStart)} a {showDate(r.periodEnd)}
                  </span>
                </Link>
              </Row>
            ))
          )}
        </HomeCard>

        <HomeCard
          icon={LayoutDashboard}
          tint="sky"
          title={t("dashboards")}
          primary={canEdit && hasIntegrations ? { label: "+ Novo dashboard", onClick: () => void createDashboard() } : undefined}
          secondary={{ label: t("seeAll", { count: (dashboards?.length ?? 0) + (hasIntegrations ? 1 : 0) }), href: "/operational/reportei/dashboards" }}
        >
          {(dashboards ?? []).slice(0, 2).map((d) => (
            <Row key={d.id}>
              <Link href={`/operational/reportei/dashboards/${clientId}/v4/${d.id}`} className="block space-y-1 hover:opacity-80">
                <span className="flex items-center gap-1.5">
                  {d.networks.slice(0, 4).map((n) => (
                    <NetworkIcon key={n} network={n} size={16} />
                  ))}
                </span>
                <span className="block truncate text-sm font-medium text-foreground">{d.title}</span>
              </Link>
            </Row>
          ))}
          {hasIntegrations ? (
            <Row>
              <Link href={dashboardHref} className="block space-y-1 hover:opacity-80">
                <span className="flex items-center gap-1.5">
                  {networks.slice(0, 3).map((n) => (
                    <NetworkIcon key={n} network={n} size={16} />
                  ))}
                </span>
                <span className="block truncate text-sm font-medium text-foreground">{t("liveDashboard")}</span>
                <span className="block text-xs text-muted-foreground">{t("liveDashboardHint")}</span>
              </Link>
            </Row>
          ) : (
            <Empty>{t("dashboardsNeedAccounts")}</Empty>
          )}
        </HomeCard>

        <HomeCard
          icon={Target}
          tint="blue"
          title={t("goals")}
          primary={{ label: `+ ${goals && (goals.monthlyBudget !== null || goals.maxCpc !== null) ? t("goalsEdit") : t("goalsSet")}`, href: dashboardHref }}
          secondary={{ label: t("goalsPanel"), href: dashboardHref }}
        >
          {goals && (goals.monthlyBudget !== null || goals.maxCpc !== null) ? (
            <>
              <Row>
                <span className="block text-xs text-muted-foreground">{t("goalBudget")}</span>
                <span className="block text-base font-semibold text-foreground">
                  {goals.monthlyBudget !== null ? goals.monthlyBudget.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : t("goalNone")}
                </span>
              </Row>
              <Row>
                <span className="block text-xs text-muted-foreground">{t("goalMaxCpc")}</span>
                <span className="block text-base font-semibold text-foreground">
                  {goals.maxCpc !== null ? goals.maxCpc.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : t("goalNone")}
                </span>
              </Row>
            </>
          ) : (
            <Empty>{t("goalsEmpty")}</Empty>
          )}
        </HomeCard>

        <HomeCard
          icon={Flag}
          tint="purple"
          title={t("timeline")}
          primary={canEdit ? { label: `+ ${events && events.length > 0 ? t("timelineNew") : t("timelineFirst")}`, onClick: () => onGo("timeline") } : undefined}
          secondary={{ label: t("seeAll", { count: events?.length ?? 0 }), onClick: () => onGo("timeline") }}
        >
          {events === null ? (
            <Empty>…</Empty>
          ) : events.length === 0 ? (
            <Empty>{t("timelineEmpty")}</Empty>
          ) : (
            events.slice(0, 3).map((e) => (
              <Row key={e.id}>
                <span className="flex items-start gap-2">
                  <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                  <span className="min-w-0">
                    <span className="block text-xs text-muted-foreground">{showDate(e.date)}</span>
                    <span className="block truncate text-sm font-medium text-foreground">{e.title}</span>
                  </span>
                </span>
              </Row>
            ))
          )}
        </HomeCard>

        <HomeCard
          icon={Zap}
          tint="orange"
          title={t("automation")}
          primary={canEdit ? { label: `+ ${automation ? t("automationConfigure") : t("automationNew")}`, onClick: () => onGo("automations") } : undefined}
          secondary={{ label: "Ver automação", onClick: () => onGo("automations") }}
        >
          {automation === undefined ? (
            <Empty>…</Empty>
          ) : automation === null ? (
            <Empty>{t("automationEmpty")}</Empty>
          ) : (
            <div className="my-2 space-y-3 rounded-xl bg-muted/40 p-3">
              <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", automation.active ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-400 text-white")}>
                {automation.active ? t("active") : t("paused")}
              </span>
              <div className="flex items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{automation.reportTitle ?? automation.lastReport?.title ?? t("automationDefaultTitle", { name: clientName })}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`freqAdverb_${automation.frequency}`)} · {lower(tp(`period_${automation.analysisPeriod ?? defaultAnalysisPeriod(automation.frequency)}`))}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-border rounded-lg border border-border bg-card text-xs">
                <div className="space-y-1 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("lastRun")}</p>
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    {automation.lastError ? <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> : automation.lastReport ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
                    {automation.lastError ? t("runError") : automation.lastReport ? t("runOk") : t("runNever")}
                  </p>
                </div>
                <div className="space-y-1 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t("nextRun")}</p>
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    {!automation.active ? t("runPaused") : nextRun === 1 ? t("tomorrow") : t("inDays", { count: nextRun ?? 0 })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </HomeCard>
      </div>

    </div>
  );
}
