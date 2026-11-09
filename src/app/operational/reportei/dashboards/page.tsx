"use client";

// Operacional → Reportei → Dashboards: the general dashboard. The default view reads the
// real Meta Ads accounts linked to each client (GET /api/operational/reportei/overview).
// What cannot be read is shown as unavailable, with the reason: it is never replaced by
// made-up numbers. "Prévia com números fictícios" is a separate, clearly marked mode, only
// to look at the layout. The table with the live Meta numbers per client is at ./tabela.

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Megaphone, Minus, Sparkles, TableProperties, TrendingUp, TriangleAlert } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import type { ClientCardData } from "@/lib/reportei/client-card";
import { dashboardOpeningPeriod, type DashboardPeriod } from "@/lib/reportei/dashboard-doc";
import { formatDec, formatInt, formatMoney, showDate } from "@/lib/reportei/format";
import {
  RULES, WHY_TEXT, classify, dailySeries, deltaPct, demoOverview, goodness, isNewResult, leadRows, pendingOf, seriesTotal, totals,
  type ClientReadings, type LeadRow, type MonthLine, type MonthSeries, type Mover, type Reading,
} from "@/lib/reportei/overview";
import type { OverviewPayload } from "@/lib/reportei/overview-real";
import { resolvePeriod } from "@/lib/reportei/periods";
import { cn } from "@/lib/utils";
import { ClientAvatar } from "../_components/client-avatar";
import { PeriodSelector } from "../_components/dashboard-doc-editor";

/** Whether the period is being compared with the one before it; without it, no changes are shown. */
const CompareContext = createContext(true);

function show(r: Reading, v: number | null): string {
  if (v === null) return "—";
  switch (r.format) {
    case "money":
      return formatMoney(v, r.currency ?? "BRL");
    case "ratio":
      return `${formatDec(v)}x`;
    case "percent":
      return `${formatDec(v)}%`;
    default:
      return formatInt(v);
  }
}

/** The number, or a dash that says on hover why it is not there. */
function Value({ r, v }: { r: Reading; v: number | null }) {
  if (v !== null) return <>{show(r, v)}</>;
  return (
    <span title={r.why ? WHY_TEXT[r.why] : "Indisponível"} className="cursor-help text-muted-foreground">
      —
    </span>
  );
}

/** The change as a small badge: green when it is better, red when worse; "novo" when there was nothing before. */
function Delta({ r, big }: { r: Reading; big?: boolean }) {
  const comparing = useContext(CompareContext);
  if (!comparing || r.value === null) return null;
  const size = big ? "gap-1 rounded-lg px-2.5 py-1 text-base" : "px-1.5 py-0.5 text-xs";
  if (isNewResult(r)) return <span className={cn("inline-flex items-center rounded-md bg-emerald-500/15 font-semibold text-emerald-500", size)}>novo</span>;
  const d = deltaPct(r);
  if (d === null) return <span title={WHY_TEXT.no_base} className="cursor-help text-xs text-muted-foreground">sem base</span>;
  const g = goodness(r);
  const Icon = Math.abs(d) < 0.05 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  const tone = g === null ? "bg-muted text-muted-foreground" : g >= 0.05 ? "bg-emerald-500/15 text-emerald-500" : g <= -0.05 ? "bg-red-500/15 text-red-500" : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-md font-semibold", size, tone)}>
      <Icon className={big ? "h-4 w-4" : "h-3 w-3"} />
      {formatDec(Math.abs(d))}%
    </span>
  );
}

function TotalCard({ r, covered, total }: { r: Reading; covered: number; total: number }) {
  const comparing = useContext(CompareContext);
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 text-center shadow-sm">
      <p className="text-sm font-medium text-muted-foreground">{r.label}</p>
      <p className="mt-1 flex items-center justify-center gap-2 text-2xl font-bold text-foreground">
        <Value r={r} v={r.value} />
        <Delta r={r} />
      </p>
      {r.value === null ? (
        <p className="mt-1 text-xs text-muted-foreground">{r.why ? WHY_TEXT[r.why] : "Indisponível"}</p>
      ) : (
        <>
          {comparing && r.previous !== null && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{show(r, r.previous)}</span> no período anterior
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {covered} de {total} clientes
          </p>
        </>
      )}
    </div>
  );
}

function MoverCard({ m, tone }: { m: Mover; tone: "good" | "bad" }) {
  const r = m.reading;
  const verb = m.delta >= 0 ? "subiu" : "caiu";
  return (
    <Link href={`/operational/reportei/clientes/${m.clientId}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/50">
      <ClientAvatar name={m.name} logoUrl={m.logoUrl} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{m.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {r.label} {verb} de {show(r, r.previous)}
        </p>
        {m.contrary && (
          <p className="truncate text-[11px] text-amber-500">
            Mas {m.contrary.label} {m.contrary.delta >= 0 ? "subiu" : "caiu"} {formatDec(Math.abs(m.contrary.delta))}%
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className={cn("text-base font-bold", tone === "good" ? "text-emerald-500" : "text-red-500")}>{show(r, r.value)}</span>
        <Delta r={r} />
      </div>
    </Link>
  );
}

function Section({ title, hint, icon: Icon, tone, items, empty }: { title: string; hint: string; icon: typeof TrendingUp; tone: "good" | "bad"; items: Mover[]; empty: string }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card/40 p-4">
      <header className="flex items-center gap-3">
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tone === "good" ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500")}>
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </header>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((m) => (
            <MoverCard key={m.clientId} m={m} tone={tone} />
          ))}
        </div>
      )}
    </section>
  );
}

const LEADS_GRID = "grid-cols-[minmax(0,1fr)_9rem_10rem_12rem] sm:grid-cols-[minmax(0,1fr)_11rem_11rem_15rem]";

function LeadsSection({ rows }: { rows: LeadRow[] }) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card/40 p-4">
      <header className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500">
          <Megaphone className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Geração de leads</h2>
          <p className="text-xs text-muted-foreground">Clientes de captação: leads gerados, custo por lead e faturamento atribuído no período</p>
        </div>
      </header>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Nenhum cliente de geração de leads configurado e lido. Defina o tipo do cliente na página dele.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className={cn("grid gap-3 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", LEADS_GRID)}>
            <span>Cliente</span>
            <span className="text-right">Leads gerados</span>
            <span className="text-right">CPL</span>
            <span className="text-right">Faturamento</span>
          </div>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.clientId}>
                <Link href={"/operational/reportei/clientes/" + row.clientId} className={cn("grid items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50", LEADS_GRID)}>
                  <span className="flex min-w-0 items-center gap-3">
                    <ClientAvatar name={row.name} logoUrl={row.logoUrl} size={36} />
                    <span className="truncate text-sm font-semibold text-foreground">{row.name}</span>
                  </span>
                  <span className="flex items-center justify-end gap-2 text-sm font-semibold text-foreground">
                    <Value r={row.leads} v={row.leads.value} />
                    <Delta r={row.leads} />
                  </span>
                  <span className="flex items-center justify-end gap-2 text-sm font-semibold text-foreground">
                    {row.cpl ? <Value r={row.cpl} v={row.cpl.value} /> : "—"}
                  </span>
                  <span className="flex items-center justify-end gap-2 text-sm font-semibold text-foreground">
                    <Value r={row.revenue} v={row.revenue.value} />
                    <Delta r={row.revenue} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** A metric of the current month day by day, with the month before dashed underneath. The big number is the sum of the chart itself. */
function MonthChart({ title, line, month, before, format }: { title: string; line: MonthLine; month: { since: string; until: string }; before: { since: string; until: string }; format: "money" }) {
  const name = MONTH_NAMES[Number(month.since.slice(5, 7)) - 1];
  const reading: Reading | null = line.now
    ? { key: title, label: title, value: seriesTotal(line.now), previous: line.before ? seriesTotal(line.before) : null, format, currency: line.currency, upIsGood: true, neutral: title === "Investimento" }
    : null;
  const data = useMemo(() => {
    if (!line.now) return [];
    return line.now.map((p, i) => ({ date: p.date, value: p.value, previousDate: line.before?.[i]?.date, previousValue: line.before?.[i]?.value }));
  }, [line]);
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold text-foreground">
            {title} em {name}
          </h2>
          <p className="text-xs text-muted-foreground">
            Acumulado do mês, {showDate(month.since).slice(0, 5)} a {showDate(month.until).slice(0, 5)} · tracejado: {showDate(before.since).slice(0, 5)} a {showDate(before.until).slice(0, 5)}
          </p>
        </div>
        {reading ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">{show(reading, reading.value)}</span>
            <div className="flex flex-col items-start gap-1.5">
              {reading.previous !== null && (
                <>
                  <CompareContext.Provider value={true}>
                    <Delta r={reading} big />
                  </CompareContext.Provider>
                  <span className="text-sm text-muted-foreground">
                    contra <span className="font-semibold text-foreground">{show(reading, reading.previous)}</span> no mês anterior
                  </span>
                </>
              )}
              {line.covered < line.total && (
                <span className="text-xs text-amber-500">
                  Cobre {line.covered} de {line.total} contas
                </span>
              )}
            </div>
          </div>
        ) : null}
      </header>
      {line.now ? (
        <div className="h-72 w-full text-primary" role="img" aria-label={title + " por dia no mês"}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" style={{ stroke: "var(--border)" }} />
              <XAxis dataKey="date" tickFormatter={(d: string) => showDate(d).slice(0, 5)} tick={{ fontSize: 10 }} minTickGap={24} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(v: number) => (v >= 1000 ? formatInt(Math.round(v / 1000)) + " mil" : String(Math.round(v)))} tick={{ fontSize: 10 }} width={52} tickLine={false} axisLine={false} />
              <Tooltip
                formatter={(v, key) => [formatMoney(Number(v), line.currency ?? "BRL"), key === "previousValue" ? "Mês anterior" : title]}
                labelFormatter={(d) => showDate(String(d))}
                labelStyle={{ color: "#ffffff", fontWeight: 600 }}
                itemStyle={{ color: "#10b981", fontWeight: 600 }}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
              />
              {line.before && <Line dataKey="previousValue" stroke="currentColor" strokeOpacity={0.4} strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />}
              <Line dataKey="value" stroke="currentColor" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {title} diário indisponível: {line.why ? WHY_TEXT[line.why].toLowerCase() : "sem dados"}.
        </p>
      )}
    </section>
  );
}

/** The answer for one period; `key` says which, so a stale answer is never shown for another period. */
type Loaded = { kind: "loading" } | { kind: "error"; key: string } | { kind: "ready"; key: string; clients: ClientCardData[]; payload: OverviewPayload };

export default function ReporteiDashboardsPage() {
  const [period, setPeriod] = useState<DashboardPeriod>(() => dashboardOpeningPeriod());
  const [compare, setCompare] = useState(true);
  const [preview, setPreview] = useState(false);
  const [state, setState] = useState<Loaded>({ kind: "loading" });

  const range = useMemo(() => ({ since: period.since, until: period.until }), [period]);
  const key = `${range.since}|${range.until}|${compare ? 1 : 0}`;

  useEffect(() => {
    if (preview) return;
    let alive = true;
    const q = new URLSearchParams({ since: range.since, until: range.until, compare: compare ? "1" : "0" });
    Promise.all([fetch("/api/operational/reportei/clients?status=active"), fetch(`/api/operational/reportei/overview?${q}`)])
      .then(async ([c, o]) => {
        if (!alive) return;
        if (!c.ok || !o.ok) return setState({ kind: "error", key });
        setState({ kind: "ready", key, clients: ((await c.json()) as { clients: ClientCardData[] }).clients, payload: (await o.json()) as OverviewPayload });
      })
      .catch(() => alive && setState({ kind: "error", key }));
    return () => {
      alive = false;
    };
  }, [range, compare, preview, key]);

  // Clients only for the preview (made-up numbers need names and logos too).
  const [previewClients, setPreviewClients] = useState<ClientCardData[] | null>(null);
  useEffect(() => {
    if (!preview || previewClients) return;
    fetch("/api/operational/reportei/clients?status=active")
      .then(async (c) => (c.ok ? setPreviewClients(((await c.json()) as { clients: ClientCardData[] }).clients) : null))
      .catch(() => null);
  }, [preview, previewClients]);

  const data = useMemo(() => {
    let readings: ClientReadings[];
    let month: MonthSeries;
    if (preview) {
      if (!previewClients) return null;
      readings = demoOverview.readings(previewClients.map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl })), range);
      const today = resolvePeriod("last_7d").until;
      const spans = monthOf(today);
      const t = totals(demoOverview.readings(previewClients.map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl })), spans.month));
      const mk = (total: number | null, prev: number | null, key: string): MonthLine => ({ now: dailySeries(total ?? 0, spans.month, key + spans.month.since), before: dailySeries(prev ?? 0, spans.before, key + spans.before.since), covered: previewClients.length, total: previewClients.length });
      month = { ...spans, spend: mk(t.spend.value, t.spend.previous, "spend"), revenue: mk(t.revenue.value, t.revenue.previous, "revenue") };
    } else {
      if (state.kind !== "ready" || state.key !== key) return null;
      const byId = new Map(state.clients.map((c) => [c.id, c]));
      readings = state.payload.clients.flatMap((row) => {
        const c = byId.get(row.clientId);
        return c ? [{ ...row, name: c.name, logoUrl: c.logoUrl }] : [];
      });
      month = state.payload.month;
    }
    return { readings, overview: classify(readings), totals: totals(readings), leads: leadRows(readings, 20), pending: pendingOf(readings), month };
  }, [preview, previewClients, state, range, key]);

  const generated = !preview && state.kind === "ready" && state.key === key ? new Date(state.payload.generatedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : null;
  const loading = preview ? !previewClients : state.kind === "loading" || (state.kind !== "error" && state.key !== key) || (state.kind === "error" && state.key !== key);

  return (
    <CompareContext.Provider value={compare}>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
            <h1 className="text-xl font-bold text-foreground">Dashboard geral</h1>
            <PeriodSelector period={period} compare={compare} disabled={false} onApply={(p, c) => { setPeriod(p); setCompare(c); }} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPreview((p) => !p)}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors", preview ? "border-amber-500/60 bg-amber-500/10 text-amber-500" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              <Sparkles className="h-4 w-4" />
              {preview ? "Sair da prévia" : "Prévia com números fictícios"}
            </button>
            <Link href="/operational/reportei/dashboards/tabela" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              <TableProperties className="h-4 w-4" />
              Tabela por cliente
            </Link>
          </div>
        </header>

        {preview ? (
          <p className="rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-600 dark:text-amber-300">PRÉVIA: todos os números desta tela são fictícios e existem só para ver o desenho. Nada aqui vem da Meta.</p>
        ) : (
          <p className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            Dados reais da Meta Ads{generated ? `, lidos às ${generated}` : ""}. Google, Instagram, Facebook e as demais redes ainda não estão integrados.
          </p>
        )}

        {loading && <Skeleton className="h-64" />}
        {!preview && state.kind === "error" && state.key === key && <EmptyState title="Não foi possível ler os dados agora." hint="Nenhum número é mostrado no lugar. Tente atualizar a página." className="min-h-40" />}
        {data && data.readings.length === 0 && <EmptyState title="Nenhum cliente ativo ainda" hint="Cadastre clientes em Reportei → Clientes." className="min-h-40" />}
        {data && data.readings.length > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <TotalCard r={data.totals.leads} covered={data.totals.coverage.leads} total={data.totals.coverage.total} />
              <TotalCard r={data.totals.conversations} covered={data.totals.coverage.conversations} total={data.totals.coverage.total} />
              <TotalCard r={data.totals.roas} covered={data.totals.coverage.revenue} total={data.totals.coverage.total} />
              <TotalCard r={data.totals.cpl} covered={data.totals.coverage.leads} total={data.totals.coverage.total} />
            </div>
            <p className="text-xs text-muted-foreground">Leads e CPL usam a fonte de leads escolhida na ficha de cada cliente. Conversas são exibidas separadamente e não são somadas novamente aos leads.</p>

            <div className="space-y-5">
              <MonthChart title="Investimento" line={data.month.spend} month={data.month.month} before={data.month.before} format="money" />
              <MonthChart title="Faturamento" line={data.month.revenue} month={data.month.month} before={data.month.before} format="money" />
            </div>

            {compare ? (
              <div className="grid items-start gap-5 lg:grid-cols-2">
                <Section title="Em destaque" hint="Clientes com um resultado melhorando" icon={TrendingUp} tone="good" items={data.overview.highlights} empty="Nenhum cliente com melhora relevante no período." />
                <Section title="Pontos de atenção" hint="Clientes com um resultado piorando" icon={TriangleAlert} tone="bad" items={data.overview.attention} empty="Nenhum cliente com piora relevante no período." />
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">Ligue a comparação com o período anterior para ver os clientes em destaque e os pontos de atenção.</p>
            )}

            <LeadsSection rows={data.leads} />

            <section className="space-y-1 rounded-xl border border-border bg-card/40 px-4 py-3 text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Como a tela decide</p>
              <p>
                Destaque: resultado que melhorou {RULES.threshold}% ou mais contra o período anterior. Atenção: piorou {RULES.threshold}% ou mais. Só entram clientes com o tipo configurado, lidos por completo, e com ao menos {RULES.minVolume.leads} leads ou {RULES.minVolume.purchases} compras nos dois períodos. Investimento, CTR e CPC são contexto, não veredito. {RULES.provisional ? "Estes limites são provisórios: ainda não foram aprovados nem podem ser configurados. " : ""}(Regra v{RULES.version}.)
              </p>
              {(data.pending.noIntegration > 0 || data.pending.notConfigured > 0 || data.pending.failed > 0 || data.pending.partial > 0) && (
                <p className="text-amber-500">
                  Pendências:{" "}
                  {[
                    data.pending.notConfigured > 0 && `${data.pending.notConfigured} sem tipo configurado`,
                    data.pending.noIntegration > 0 && `${data.pending.noIntegration} sem integração`,
                    data.pending.partial > 0 && `${data.pending.partial} com leitura incompleta`,
                    data.pending.failed > 0 && `${data.pending.failed} com falha na leitura`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  .
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </CompareContext.Provider>
  );
}

/** The month so far and the same days of the month before (preview only; the server does the same for real data). */
function monthOf(today: string) {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 2, 1));
  const lastDay = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const days = Math.min(Number(today.slice(8, 10)), lastDay);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  return { month: { since: today.slice(0, 8) + "01", until: today }, before: { since: ymd(start), until: ymd(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), days))) } };
}
