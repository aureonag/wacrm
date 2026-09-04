"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Flag, UserX, Clock3, ListChecks, PlusCircle, CheckCircle2, Timer, Hourglass, CalendarClock, Target, Users2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useHasPermission } from "@/hooks/use-permissions";
import {
  loadAccountProfiles,
  loadAccountTasksForDashboard,
  loadAccountTaskStageHistory,
  loadAccountTimesheetEntries,
  loadBoards,
  loadMySectorIds,
} from "@/lib/tasks/queries";
import type { Board, Profile, Sector, Task, TaskStageHistory, TimesheetEntry } from "@/types";
import { getPeriodRange, type DateRange, type PeriodKind } from "@/lib/dashboard/period";
import {
  buildAttentionCounts,
  buildDeadlineMetrics,
  buildTeamRows,
  buildTimeMetrics,
  buildVolumeMetrics,
  resolveDashboardScope,
  scopeTasks,
} from "@/lib/operational-dashboard/queries";
import { formatMinutes } from "@/lib/tasks/timesheet";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { StatTile } from "@/components/dashboard/stat-tile";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { TeamTable } from "@/components/operational-dashboard/team-table";

const ALL = "__all";

export default function OperationalDashboardPage() {
  const t = useTranslations("Operational.dashboard");
  const { accountId, profile } = useAuth();
  const supabase = createClient();

  const hasViewAll = useHasPermission("operational", "dashboard", "view_all");
  const hasViewSector = useHasPermission("operational", "dashboard", "view_sector");
  const hasViewOwn = useHasPermission("operational", "dashboard", "view_own");
  const hasLegacyView = useHasPermission("operational", "dashboard", "view");
  const scope = resolveDashboardScope(hasViewAll, hasViewSector, hasViewOwn, hasLegacyView);

  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stageHistory, setStageHistory] = useState<TaskStageHistory[]>([]);
  const [timesheet, setTimesheet] = useState<TimesheetEntry[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [mySectorIds, setMySectorIds] = useState<string[]>([]);

  const [periodKind, setPeriodKind] = useState<PeriodKind>("all");
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [boardFilter, setBoardFilter] = useState(ALL);
  const [sectorFilter, setSectorFilter] = useState(ALL);
  const [personFilter, setPersonFilter] = useState(ALL);

  useEffect(() => {
    if (!accountId || !scope) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [taskRows, historyRows, timesheetRows, boardRows, sectorRows, profileRows, sectorIds] = await Promise.all([
        loadAccountTasksForDashboard(supabase, accountId),
        loadAccountTaskStageHistory(supabase, accountId),
        loadAccountTimesheetEntries(supabase, accountId),
        loadBoards(supabase),
        supabase.from("sectors").select("*").eq("account_id", accountId).order("name"),
        loadAccountProfiles(supabase, accountId),
        profile ? loadMySectorIds(supabase, profile.id) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setTasks(taskRows);
      setStageHistory(historyRows);
      setTimesheet(timesheetRows);
      setBoards(boardRows);
      setSectors((sectorRows.data ?? []) as Sector[]);
      setProfiles(profileRows);
      setMySectorIds(sectorIds);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, scope, profile?.id]);

  const periodRange = useMemo(() => getPeriodRange(periodKind, customRange ?? undefined), [periodKind, customRange]);

  const scopedTasks = useMemo(
    () => (scope ? scopeTasks(tasks, scope, profile?.id, mySectorIds) : []),
    [tasks, scope, profile?.id, mySectorIds],
  );

  const filteredTasks = useMemo(() => {
    return scopedTasks.filter((t) => {
      if (boardFilter !== ALL && t.board_id !== boardFilter) return false;
      if (sectorFilter !== ALL && t.sector_id !== sectorFilter) return false;
      if (personFilter !== ALL && t.assignee_id !== personFilter) return false;
      return true;
    });
  }, [scopedTasks, boardFilter, sectorFilter, personFilter]);

  const scopedTaskIds = useMemo(() => new Set(filteredTasks.map((t) => t.id)), [filteredTasks]);
  const filteredTimesheet = useMemo(
    () => timesheet.filter((e) => scopedTaskIds.has(e.task_id)),
    [timesheet, scopedTaskIds],
  );
  const filteredHistory = useMemo(
    () => stageHistory.filter((h) => scopedTaskIds.has(h.task_id)),
    [stageHistory, scopedTaskIds],
  );

  const volume = useMemo(() => buildVolumeMetrics(filteredTasks, boards, periodRange), [filteredTasks, boards, periodRange]);
  const time = useMemo(() => buildTimeMetrics(filteredTasks, filteredTimesheet, periodRange), [filteredTasks, filteredTimesheet, periodRange]);
  const deadlines = useMemo(() => buildDeadlineMetrics(filteredTasks, periodRange), [filteredTasks, periodRange]);
  const attention = useMemo(() => buildAttentionCounts(filteredTasks, filteredHistory), [filteredTasks, filteredHistory]);
  const team = useMemo(() => buildTeamRows(filteredTasks, filteredTimesheet, periodRange), [filteredTasks, filteredTimesheet, periodRange]);

  if (!scope) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <EmptyState title={t("noPermissionTitle")} hint={t("noPermissionHint")} className="min-h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <PeriodFilter
          kind={periodKind}
          custom={customRange}
          onChange={(kind, custom) => {
            setPeriodKind(kind);
            setCustomRange(custom ?? null);
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterSelect
          value={boardFilter}
          onChange={setBoardFilter}
          placeholder={t("filterBoard")}
          options={boards.map((b) => ({ value: b.id, label: b.name }))}
        />
        {scope !== "own" && (
          <FilterSelect
            value={sectorFilter}
            onChange={setSectorFilter}
            placeholder={t("filterSector")}
            options={sectors.map((s) => ({ value: s.id, label: s.name }))}
          />
        )}
        {scope !== "own" && (
          <FilterSelect
            value={personFilter}
            onChange={setPersonFilter}
            placeholder={t("filterPerson")}
            options={profiles.map((p) => ({ value: p.id, label: p.full_name }))}
          />
        )}
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        <>
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                {t("attention.title")}
              </CardTitle>
              <CardDescription>{t("attention.description")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile icon={<Clock3 className="h-3.5 w-3.5" />} label={t("attention.overdue")} value={String(attention.overdue)} />
              <StatTile icon={<Flag className="h-3.5 w-3.5" />} label={t("attention.urgent")} value={String(attention.urgent)} />
              <StatTile icon={<UserX className="h-3.5 w-3.5" />} label={t("attention.unassigned")} value={String(attention.unassigned)} />
              <StatTile icon={<Hourglass className="h-3.5 w-3.5" />} label={t("attention.stuck")} value={String(attention.stuck)} />
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <ListChecks className="h-4 w-4 text-blue-400" />
                  {t("volume.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StatTile icon={<ListChecks className="h-3.5 w-3.5" />} label={t("volume.totalOpen")} value={String(volume.totalOpen)} />
                  <StatTile icon={<PlusCircle className="h-3.5 w-3.5" />} label={t("volume.createdInPeriod")} value={String(volume.createdInPeriod)} />
                  <StatTile icon={<CheckCircle2 className="h-3.5 w-3.5" />} label={t("volume.completedInPeriod")} value={String(volume.completedInPeriod)} />
                </div>
                {volume.byBoard.length > 0 ? (
                  <div className="space-y-1.5">
                    {volume.byBoard.map((b) => (
                      <div key={b.boardId} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{b.boardName}</span>
                        <span className="font-medium text-foreground">{b.count}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title={t("volume.emptyByBoard")} />
                )}
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Timer className="h-4 w-4 text-purple-400" />
                  {t("time.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <StatTile
                  icon={<Timer className="h-3.5 w-3.5" />}
                  label={t("time.avgCompletion")}
                  value={time.avgCompletionMinutes !== null ? formatMinutes(time.avgCompletionMinutes) : "—"}
                />
                <StatTile icon={<Clock3 className="h-3.5 w-3.5" />} label={t("time.totalLogged")} value={formatMinutes(time.totalMinutesLogged)} />
              </CardContent>
            </Card>

            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <CalendarClock className="h-4 w-4 text-red-400" />
                  {t("deadlines.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <StatTile icon={<Clock3 className="h-3.5 w-3.5" />} label={t("deadlines.overdue")} value={String(deadlines.overdueCount)} />
                <StatTile icon={<CalendarClock className="h-3.5 w-3.5" />} label={t("deadlines.dueSoon")} value={String(deadlines.dueSoonCount)} />
                <StatTile
                  icon={<Target className="h-3.5 w-3.5" />}
                  label={t("deadlines.onTimeRate")}
                  value={deadlines.onTimeRate !== null ? `${deadlines.onTimeRate}%` : "—"}
                />
              </CardContent>
            </Card>

            {scope !== "own" && (
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <Users2 className="h-4 w-4 text-emerald-400" />
                    {t("team.title")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <TeamTable rows={team} />
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? ALL)}>
      <SelectTrigger className="h-8 bg-muted border-border text-xs text-foreground">
        <SelectValue>{value === ALL ? placeholder : (options.find((o) => o.value === value)?.label ?? placeholder)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
