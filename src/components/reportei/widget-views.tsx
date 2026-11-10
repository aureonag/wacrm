"use client";

// How each kind of indicator of a report document looks: the number with its change,
// bar / line / grouped-bar / pie charts, plain and post tables, and the stories grid.
// Same look as Reportei's report. No editing here; the shell around it adds that.

import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarDays, CircleHelp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { NetworkIcon } from "@/app/operational/reportei/_components/network-icon";
import { changeOf, formatValue, sortRows, type GroupedBarWidget, type MetricWidget, type PieWidget, type PostsWidget, type SeriesWidget, type StoriesWidget, type TableWidget, type Widget } from "@/lib/reportei/doc";
import { formatDec, formatInt, formatMoney, showDate, showDateTime } from "@/lib/reportei/format";
import { filterCampaignRows, type CampaignFilter } from "@/lib/reportei/campaign-table";
import { safeAdThumbnail } from "@/lib/reportei/ad-table";
import { cn } from "@/lib/utils";

const TONE = { good: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400", bad: "bg-red-500/15 text-red-600 dark:text-red-400", neutral: "bg-muted text-muted-foreground" } as const;
const GREEN = "#16a34a";

export function WidgetTitle({ title, description }: { title: string; description: string }) {
  return (
    <h3 className="flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-foreground">
      <span>{title}</span>
      {description && (
        <span title={description} className="no-print inline-flex cursor-help">
          <CircleHelp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </span>
      )}
    </h3>
  );
}

/** "Aumento da variação" etc. are in the editor; this is only the card. */
function MetricView({ w }: { w: MetricWidget }) {
  const change = changeOf(w);
  return (
    <div className="space-y-1.5 text-center">
      <WidgetTitle title={w.title} description={w.description} />
      {w.networks.length > 0 && (
        <div className="flex justify-center gap-1">
          {w.networks.map((n) => (
            <NetworkIcon key={n} network={n} size={13} />
          ))}
        </div>
      )}
      {w.period && (
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          <CalendarDays className="h-3 w-3" />
          {showDate(w.period.since)} a {showDate(w.period.until)}
        </span>
      )}
      <div className="flex items-center justify-center gap-2">
        <span className="text-2xl font-bold text-foreground">{formatValue(w.value, w.format, w.decimals, w.currency)}</span>
        {change && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold", TONE[change.tone])}>
            {change.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {change.text}
          </span>
        )}
      </div>
      {w.comparison && w.previous !== null && (
        <p className="text-xs text-muted-foreground">
          <b className="font-semibold text-foreground">{formatValue(w.previous, w.format, w.decimals, w.currency)}</b> no período anterior
        </p>
      )}
    </div>
  );
}

const tick = { fontSize: 10, fill: "var(--muted-foreground)" } as const;
const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } as const;

function SeriesView({ w }: { w: SeriesWidget }) {
  const nf = (v: number) => formatInt(v);
  return (
    <div>
      <WidgetTitle title={w.title} description={w.description} />
      <div className="mt-2 h-56 w-full" role="img" aria-label={w.title}>
        <ResponsiveContainer width="100%" height="100%">
          {w.kind === "line" ? (
            <LineChart data={w.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" style={{ stroke: "var(--border)" }} />
              <XAxis dataKey="label" tick={tick} angle={-45} textAnchor="end" height={56} interval="preserveStartEnd" minTickGap={14} tickLine={false} axisLine={false} />
              <YAxis tick={tick} width={42} tickFormatter={nf} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [nf(Number(v)), w.seriesName]} />
              <Legend verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 11 }} formatter={() => w.seriesName} />
              <Line dataKey="value" stroke={GREEN} strokeWidth={2} dot={false} type="monotone" isAnimationActive={false} />
            </LineChart>
          ) : (
            <BarChart data={w.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" style={{ stroke: "var(--border)" }} />
              <XAxis dataKey="label" tick={tick} angle={-45} textAnchor="end" height={w.points.length > 12 ? 56 : 28} interval="preserveStartEnd" minTickGap={10} tickLine={false} axisLine={false} />
              <YAxis tick={tick} width={42} tickFormatter={nf} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => [nf(Number(v)), w.seriesName]} />
              <Legend verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 11 }} formatter={() => w.seriesName} />
              <Bar dataKey="value" fill={GREEN} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function GroupedBarView({ w }: { w: GroupedBarWidget }) {
  const data = w.categories.map((label, i) => ({ label, ...Object.fromEntries(w.series.map((s) => [s.name, s.values[i] ?? 0])) }));
  return (
    <div>
      <WidgetTitle title={w.title} description={w.description} />
      <div className="mt-2 h-56 w-full" role="img" aria-label={w.title}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" style={{ stroke: "var(--border)" }} />
            <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} />
            <YAxis tick={tick} width={42} tickFormatter={(v: number) => formatInt(v)} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            {w.series.map((s) => (
              <Bar key={s.name} dataKey={s.name} fill={s.color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function PieView({ w }: { w: PieWidget }) {
  const total = w.slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div>
      <WidgetTitle title={w.title} description={w.description} />
      <div className="mt-2 h-56 w-full" role="img" aria-label={w.title}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Legend verticalAlign="top" height={24} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toLocaleString("pt-BR")}%`} />
            <Pie
              data={w.slices}
              dataKey="value"
              nameKey="label"
              outerRadius="80%"
              stroke="none"
              isAnimationActive={false}
              label={({ value }) => `${(((Number(value) || 0) / total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
              labelLine={false}
            >
              {w.slices.map((s) => (
                <Cell key={s.label} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function SortHeader({ label, align, active, onClick }: { label: string; align: "left" | "right"; active: boolean; onClick: () => void }) {
  return (
    <th className={cn("px-3 py-2.5 text-[11px] font-semibold", align === "right" ? "text-right" : "text-left", active ? "text-primary" : "text-muted-foreground")}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-foreground">
        {label}
        {active && <span aria-hidden>↓</span>}
      </button>
    </th>
  );
}

function AdThumbnail({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-md bg-muted px-1 text-center text-[10px] text-muted-foreground">Sem prévia</span>;
  // Meta supplies expiring CDN URLs; load directly, without sending a Graph token.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" width={72} height={72} onError={() => setFailed(true)} className="h-[72px] w-[72px] shrink-0 rounded-md object-cover" />;
}

function TableView({ w }: { w: TableWidget }) {
  const [sortKey, setSortKey] = useState(w.sortKey);
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>("all");
  const campaigns = w.key === "campaigns" && !!w.campaignReadAt;
  const ads = w.key === "ads";
  const rows = sortRows(campaigns ? filterCampaignRows(w.rows, campaignFilter) : w.rows, sortKey);
  return (
    <div>
      <WidgetTitle title={w.title} description={w.description} />
      {ads && <div className="mt-3 space-y-1 text-center text-[11px] text-muted-foreground">
        <p>{rows.length} anúncios com veiculação no período. Leads seguem a fonte configurada no cliente.</p>
        {w.adReadAt && <p>Status consultado em {showDateTime(w.adReadAt)}.</p>}
        {w.adMetadataUnavailable && <p role="status">Alguns status ou criativos não puderam ser consultados. Os resultados do período foram preservados.</p>}
      </div>}
      {campaigns && (
        <div className="mt-3 space-y-2">
          <div className="no-print flex flex-wrap justify-center gap-1.5" role="group" aria-label="Filtro de campanhas" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {([ ["all", "Todas"], ["active", "Ativas agora"], ["delivered", "Com veiculação no período"] ] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={campaignFilter === value} onClick={() => setCampaignFilter(value)} className={cn("rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-primary", campaignFilter === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
          <p className="text-center text-[11px] text-muted-foreground" aria-live="polite">{rows.length} de {w.rows.length} campanhas · {campaignFilter === "active" ? "Status ACTIVE na coleta, independentemente da veiculação no período." : campaignFilter === "delivered" ? "Pelo menos uma impressão no período, mesmo se pausada hoje." : "Status atual e resultados do período selecionado."}</p>
          <p className="text-center text-[11px] text-muted-foreground">Status consultado em {showDateTime(w.campaignReadAt!)}. Leads seguem a fonte configurada no cliente.</p>
        </div>
      )}
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className={cn("w-full text-sm", campaigns && "min-w-[60rem]", ads && "min-w-[90rem]")}>
          <thead className="bg-muted/40">
            <tr>
              {w.columns.map((c) => (
                <SortHeader key={c.key} label={c.label} align={c.align} active={sortKey === c.key} onClick={() => setSortKey(c.key)} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                {w.columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-3 text-foreground", c.align === "right" && "text-right tabular-nums")}>
                    {ads && c.key === "ad" ? <span className="flex min-w-[18rem] items-center gap-3">
                      <AdThumbnail key={String(w.adThumbnails?.[String(r._adId)] ?? r._adId)} url={safeAdThumbnail(w.adThumbnails?.[String(r._adId)])} />
                      <span className="text-[13px] font-medium">{r.ad}</span>
                    </span> : typeof r[c.key] === "number" ? (campaigns && c.key === "spend") || (ads && ["spend", "cost_per_lead", "link_cpc", "cpm"].includes(c.key)) ? w.currency ? formatMoney(r[c.key] as number, w.currency) : formatDec(r[c.key] as number) : ads && c.key === "link_ctr" ? `${formatDec(r[c.key] as number)}%` : formatInt(r[c.key] as number) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
            {campaigns && rows.length === 0 && <tr><td colSpan={w.columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">{campaignFilter === "active" ? "Nenhuma campanha ativa na coleta." : campaignFilter === "delivered" ? "Nenhuma campanha teve impressões no período." : "Nenhuma campanha encontrada para esta conta ou seleção."}</td></tr>}
            {ads && rows.length === 0 && <tr><td colSpan={w.columns.length} className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum anúncio teve veiculação neste período para esta conta ou seleção.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A made-up picture for a post or a story: a soft gradient from its hue. */
function Thumb({ hue, className }: { hue: number; className?: string }) {
  return <span aria-hidden className={cn("block shrink-0 rounded-md", className)} style={{ background: `linear-gradient(145deg, hsl(${hue} 45% 32%), hsl(${hue + 30} 50% 55%))` }} />;
}

function PostsView({ w }: { w: PostsWidget }) {
  const [sortKey, setSortKey] = useState(w.sortKey);
  const rows = sortKey
    ? [...w.rows].sort((a, b) => {
        const av = a.values[sortKey];
        const bv = b.values[sortKey];
        return typeof av === "number" && typeof bv === "number" ? bv - av : String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
      })
    : w.rows;
  return (
    <div>
      <WidgetTitle title={w.title} description={w.description} />
      <p className="no-print mt-2 text-right text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Role para ver mais →</p>
      <div className="mt-1 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground">Postagem</th>
              {w.columns.map((c) => (
                <SortHeader key={c.key} label={c.label} align={c.align} active={sortKey === c.key} onClick={() => setSortKey(c.key)} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-3">
                  <span className="flex items-center gap-3">
                    <Thumb hue={r.hue} className="h-14 w-11" />
                    <span className="max-w-[12rem] text-[13px] font-medium text-foreground">{r.text}</span>
                  </span>
                </td>
                {w.columns.map((c) => (
                  <td key={c.key} className={cn("px-3 py-3 text-foreground", c.align === "right" && "text-right tabular-nums")}>
                    {typeof r.values[c.key] === "number" ? formatInt(r.values[c.key] as number) : r.values[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StoriesView({ w }: { w: StoriesWidget }) {
  return (
    <div>
      <WidgetTitle title={w.title} description={w.description} />
      <div className="mt-4 grid gap-x-6 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
        {w.items.map((it, i) => (
          <div key={i} className="flex gap-3">
            <Thumb hue={it.hue} className="h-44 w-24" />
            <ul className="min-w-0 space-y-1 text-xs text-muted-foreground">
              {it.stats.map((s) => (
                <li key={s.label}>
                  {s.label}: <b className="font-semibold text-foreground">{typeof s.value === "number" ? formatInt(s.value) : s.value}</b>
                </li>
              ))}
              <li>
                Data: <b className="font-semibold text-foreground">{it.date}</b>
              </li>
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The body of one indicator, whatever its kind. */
/** An indicator that has no number: its title and the reason, so a gap is never read as a zero. */
function UnavailableView({ w }: { w: Widget }) {
  return (
    <div className="space-y-1 py-2 text-center">
      <p className="text-sm font-medium text-muted-foreground">{w.title}</p>
      <p className="text-2xl font-bold text-muted-foreground">—</p>
      <p className="text-xs text-muted-foreground">{w.unavailable}</p>
    </div>
  );
}

export function WidgetBody({ w }: { w: Widget }) {
  if (w.unavailable) return <UnavailableView w={w} />;
  switch (w.kind) {
    case "metric":
      return <MetricView w={w} />;
    case "bar":
    case "line":
      return <SeriesView w={w} />;
    case "groupedBar":
      return <GroupedBarView w={w} />;
    case "pie":
      return <PieView w={w} />;
    case "table":
      return <TableView w={w} />;
    case "posts":
      return <PostsView w={w} />;
    case "stories":
      return <StoriesView w={w} />;
  }
}

/** The width an indicator takes in the 12-column grid of its block. */
export function spanOf(w: Widget): string {
  const wide = w.size === "wide";
  switch (w.kind) {
    case "metric":
      return wide ? "md:col-span-6" : "md:col-span-3";
    case "bar":
    case "line":
    case "groupedBar":
    case "pie":
      return wide ? "md:col-span-12" : "md:col-span-6";
    default:
      return "md:col-span-12";
  }
}
