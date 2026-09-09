"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { getYearOptions } from "@/lib/finance/period";
import { MONTH_NAMES_PT } from "@/lib/finance/types";
import { MonthCell, DescriptionCell } from "@/components/financeiro/spreadsheet-cell";
import type {
  FinServiceLine,
  FinClient,
  FinClientValue,
  FinTeamMember,
  FinTeamAllocation,
} from "@/lib/finance/types";

const selectClass =
  "h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTH_SHORT = MONTH_NAMES_PT.map((n) => n.slice(0, 3));

interface AllocRow {
  key: string;
  label: string;
  isFreelancer: boolean;
  teamMemberId: string | null;
  freelancerName: string | null;
}

/**
 * Linhas de serviço — one full-year spreadsheet-style grid per revenue
 * line: a row per client/team-cost, a column per month. Mirrors the
 * source spreadsheet's layout (Descrição + Jan..Dez) directly, since
 * that's the shape Allan already reads this data in.
 */
export function ServiceLinesTab() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [lines, setLines] = useState<FinServiceLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [newLineName, setNewLineName] = useState("");
  const [loadingLines, setLoadingLines] = useState(true);

  const [year, setYear] = useState(() => new Date().getFullYear());

  const [clients, setClients] = useState<FinClient[]>([]);
  const [values, setValues] = useState<FinClientValue[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientCode, setNewClientCode] = useState("");
  const [newClientResponsibleId, setNewClientResponsibleId] = useState("");

  const [teamMembers, setTeamMembers] = useState<FinTeamMember[]>([]);
  const [allocations, setAllocations] = useState<FinTeamAllocation[]>([]);
  const [loadingAllocations, setLoadingAllocations] = useState(false);
  const [draftRows, setDraftRows] = useState<AllocRow[]>([]);
  const [newAllocMemberId, setNewAllocMemberId] = useState("");
  const [newAllocFreelancer, setNewAllocFreelancer] = useState("");

  const fetchLines = useCallback(async () => {
    if (!accountId) return;
    setLoadingLines(true);
    const { data } = await supabase
      .from("fin_service_lines")
      .select("*")
      .order("sort_order")
      .order("name");
    const rows = (data as FinServiceLine[] | null) ?? [];
    setLines(rows);
    setLoadingLines(false);
    setSelectedLineId((prev) => prev ?? rows[0]?.id ?? null);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchLines();
    }
  }, [accountId, fetchLines]);

  const fetchClientsAndValues = useCallback(async () => {
    if (!accountId || !selectedLineId) {
      setClients([]);
      setValues([]);
      return;
    }
    setLoadingClients(true);
    const { data: clientRows } = await supabase
      .from("fin_clients")
      .select("*")
      .eq("service_line_id", selectedLineId)
      .order("status")
      .order("sort_order");
    const cs = (clientRows as FinClient[] | null) ?? [];
    setClients(cs);

    if (cs.length > 0) {
      const { data: valueRows } = await supabase
        .from("fin_client_values")
        .select("*")
        .in(
          "client_id",
          cs.map((c) => c.id),
        )
        .eq("year", year);
      setValues((valueRows as FinClientValue[] | null) ?? []);
    } else {
      setValues([]);
    }
    setLoadingClients(false);
  }, [supabase, accountId, selectedLineId, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchClientsAndValues();
  }, [fetchClientsAndValues]);

  const fetchTeamMembers = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from("fin_team_members")
      .select("*")
      .eq("is_active", true)
      .order("name");
    setTeamMembers((data as FinTeamMember[] | null) ?? []);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchTeamMembers();
    }
  }, [accountId, fetchTeamMembers]);

  const fetchAllocations = useCallback(async () => {
    if (!accountId || !selectedLineId) {
      setAllocations([]);
      return;
    }
    setLoadingAllocations(true);
    const { data } = await supabase
      .from("fin_team_allocations")
      .select("*")
      .eq("service_line_id", selectedLineId)
      .eq("year", year)
      .order("created_at");
    setAllocations((data as FinTeamAllocation[] | null) ?? []);
    setLoadingAllocations(false);
    setDraftRows([]);
  }, [supabase, accountId, selectedLineId, year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAllocations();
  }, [fetchAllocations]);

  async function handleAddLine() {
    if (!newLineName.trim() || !accountId) return;
    const { data, error } = await supabase
      .from("fin_service_lines")
      .insert({ account_id: accountId, name: newLineName.trim(), sort_order: lines.length })
      .select()
      .single();
    if (error) {
      toast.error("Falha ao criar linha de serviço");
      return;
    }
    setNewLineName("");
    setLines((prev) => [...prev, data as FinServiceLine]);
    setSelectedLineId((data as FinServiceLine).id);
  }

  async function handleDeleteLine(line: FinServiceLine) {
    if (!confirm(`Excluir a linha "${line.name}"? Isso remove todos os clientes e alocações dela.`)) return;
    const { error } = await supabase.from("fin_service_lines").delete().eq("id", line.id);
    if (error) {
      toast.error("Falha ao excluir");
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== line.id));
    setSelectedLineId((prev) => (prev === line.id ? null : prev));
  }

  async function handleAddClient() {
    if (!newClientName.trim() || !accountId || !selectedLineId) return;
    const { data, error } = await supabase
      .from("fin_clients")
      .insert({
        account_id: accountId,
        service_line_id: selectedLineId,
        name: newClientName.trim(),
        code: newClientCode.trim() || null,
        responsible_team_member_id: newClientResponsibleId || null,
        sort_order: clients.length,
      })
      .select()
      .single();
    if (error) {
      toast.error("Falha ao adicionar cliente");
      return;
    }
    setNewClientName("");
    setNewClientCode("");
    setNewClientResponsibleId("");
    setClients((prev) => [...prev, data as FinClient]);
  }

  async function handleUpdateClientDescription(client: FinClient, raw: string) {
    // Same "CODE - Name" parsing as handleAddClient, so editing this
    // field stays consistent with how a client is created.
    const [maybeCode, ...rest] = raw.split(" - ");
    const hasCode = rest.length > 0 && /^\d+$/.test(maybeCode.trim());
    const code = hasCode ? maybeCode.trim() : null;
    const name = hasCode ? rest.join(" - ").trim() : raw;
    if (!name) return;
    const { error } = await supabase.from("fin_clients").update({ code, name }).eq("id", client.id);
    if (error) {
      toast.error("Falha ao atualizar descrição");
      return;
    }
    setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, code, name } : c)));
  }

  async function handleSetClientResponsible(client: FinClient, teamMemberId: string) {
    const { error } = await supabase
      .from("fin_clients")
      .update({ responsible_team_member_id: teamMemberId || null })
      .eq("id", client.id);
    if (error) {
      toast.error("Falha ao definir responsável");
      return;
    }
    setClients((prev) =>
      prev.map((c) => (c.id === client.id ? { ...c, responsible_team_member_id: teamMemberId || null } : c)),
    );
  }

  async function handleToggleClientStatus(client: FinClient) {
    const nextStatus = client.status === "active" ? "ended" : "active";
    const { error } = await supabase
      .from("fin_clients")
      .update({
        status: nextStatus,
        ended_at: nextStatus === "ended" ? new Date().toISOString().slice(0, 10) : null,
      })
      .eq("id", client.id);
    if (error) {
      toast.error("Falha ao atualizar status");
      return;
    }
    setClients((prev) => prev.map((c) => (c.id === client.id ? { ...c, status: nextStatus } : c)));
  }

  async function handleDeleteClient(client: FinClient) {
    if (!confirm(`Excluir "${client.name}"? Isso remove o histórico de valores dele.`)) return;
    const { error } = await supabase.from("fin_clients").delete().eq("id", client.id);
    if (error) {
      toast.error("Falha ao excluir cliente");
      return;
    }
    setClients((prev) => prev.filter((c) => c.id !== client.id));
  }

  async function handleSaveClientValue(clientId: string, month: number, raw: string) {
    if (!accountId) return;
    const amount = parseFloat(raw.replace(",", ".")) || 0;
    const { data, error } = await supabase
      .from("fin_client_values")
      .upsert(
        { account_id: accountId, client_id: clientId, year, month, amount },
        { onConflict: "client_id,year,month" },
      )
      .select()
      .single();
    if (error) {
      toast.error("Falha ao salvar valor");
      return;
    }
    const row = data as FinClientValue;
    setValues((prev) => [...prev.filter((v) => !(v.client_id === clientId && v.month === month)), row]);
  }

  function handleAddAllocationRow() {
    if (newAllocMemberId) {
      const member = teamMembers.find((m) => m.id === newAllocMemberId);
      if (!member) return;
      setDraftRows((prev) => [
        ...prev,
        { key: `member:${member.id}`, label: member.name, isFreelancer: false, teamMemberId: member.id, freelancerName: null },
      ]);
      setNewAllocMemberId("");
    } else if (newAllocFreelancer.trim()) {
      const name = newAllocFreelancer.trim();
      setDraftRows((prev) => [
        ...prev,
        { key: `freelancer:${name}`, label: name, isFreelancer: true, teamMemberId: null, freelancerName: name },
      ]);
      setNewAllocFreelancer("");
    } else {
      toast.error("Escolha um membro do time ou informe o nome do freela");
    }
  }

  async function handleSaveAllocationValue(row: AllocRow, month: number, raw: string) {
    if (!accountId || !selectedLineId) return;
    const amount = parseFloat(raw.replace(",", ".")) || 0;
    const conflictTarget = row.teamMemberId
      ? "service_line_id,team_member_id,year,month"
      : "service_line_id,freelancer_name,year,month";
    const { data, error } = await supabase
      .from("fin_team_allocations")
      .upsert(
        {
          account_id: accountId,
          service_line_id: selectedLineId,
          team_member_id: row.teamMemberId,
          freelancer_name: row.freelancerName,
          year,
          month,
          amount,
        },
        { onConflict: conflictTarget },
      )
      .select()
      .single();
    if (error) {
      toast.error("Falha ao salvar alocação");
      return;
    }
    const saved = data as FinTeamAllocation;
    setAllocations((prev) => [
      ...prev.filter(
        (a) => !(a.team_member_id === row.teamMemberId && a.freelancer_name === row.freelancerName && a.month === month),
      ),
      saved,
    ]);
    setDraftRows((prev) => prev.filter((d) => d.key !== row.key));
  }

  async function handleDeleteAllocationRow(row: AllocRow) {
    if (!confirm(`Remover todos os lançamentos de "${row.label}" nesta linha em ${year}?`)) return;
    let query = supabase
      .from("fin_team_allocations")
      .delete()
      .eq("service_line_id", selectedLineId as string)
      .eq("year", year);
    query = row.teamMemberId ? query.eq("team_member_id", row.teamMemberId) : query.eq("freelancer_name", row.freelancerName as string);
    const { error } = await query;
    if (error) {
      toast.error("Falha ao remover");
      return;
    }
    setAllocations((prev) =>
      prev.filter((a) => !(a.team_member_id === row.teamMemberId && a.freelancer_name === row.freelancerName)),
    );
    setDraftRows((prev) => prev.filter((d) => d.key !== row.key));
  }

  const selectedLine = lines.find((l) => l.id === selectedLineId) ?? null;
  const activeClients = clients.filter((c) => c.status === "active");
  const endedClients = clients.filter((c) => c.status === "ended");
  const valueByClientMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of values) map.set(`${v.client_id}:${v.month}`, v.amount);
    return map;
  }, [values]);

  // Groups active clients by who runs the account (fin_clients.responsible_team_member_id),
  // preserving each client's own sort_order so the groups fall out naturally in the
  // spreadsheet's original row order (Matheus's block, then Mauro's, etc.) — no group
  // header is shown when nobody in this line has a responsible person set yet.
  const activeGroups = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string | null; clients: FinClient[] }>();
    for (const c of activeClients) {
      const key = c.responsible_team_member_id ?? "__none__";
      if (!byKey.has(key)) {
        const member = teamMembers.find((m) => m.id === c.responsible_team_member_id);
        byKey.set(key, { key, label: member?.name ?? null, clients: [] });
      }
      byKey.get(key)!.clients.push(c);
    }
    return Array.from(byKey.values());
  }, [activeClients, teamMembers]);
  const showGroupHeaders = activeGroups.some((g) => g.label);

  const allocRows: AllocRow[] = useMemo(() => {
    const byKey = new Map<string, AllocRow>();
    for (const a of allocations) {
      const key = a.team_member_id ? `member:${a.team_member_id}` : `freelancer:${a.freelancer_name}`;
      if (!byKey.has(key)) {
        const member = teamMembers.find((m) => m.id === a.team_member_id);
        byKey.set(key, {
          key,
          label: member?.name ?? a.freelancer_name ?? "—",
          isFreelancer: !a.team_member_id,
          teamMemberId: a.team_member_id,
          freelancerName: a.freelancer_name,
        });
      }
    }
    for (const d of draftRows) if (!byKey.has(d.key)) byKey.set(d.key, d);
    return Array.from(byKey.values());
  }, [allocations, teamMembers, draftRows]);

  const allocValueByKeyMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of allocations) {
      const key = a.team_member_id ? `member:${a.team_member_id}` : `freelancer:${a.freelancer_name}`;
      map.set(`${key}:${a.month}`, a.amount);
    }
    return map;
  }, [allocations]);

  const yearRevenue = values.reduce((sum, v) => sum + v.amount, 0);
  const yearCost = allocations.reduce((sum, a) => sum + a.amount, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">Linhas de serviço</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {lines.map((line) => (
              <div key={line.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => setSelectedLineId(line.id)}
                  className={`rounded-l-lg border px-3 py-1.5 text-sm transition-colors ${
                    selectedLineId === line.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {line.name}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteLine(line)}
                  className={`rounded-r-lg border border-l-0 px-2 py-1.5 text-muted-foreground hover:text-red-400 ${
                    selectedLineId === line.id ? "border-primary bg-primary/10" : "border-border bg-muted"
                  }`}
                  title="Excluir linha"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
            {!loadingLines && lines.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma linha de serviço ainda.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={newLineName}
              onChange={(e) => setNewLineName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddLine()}
              placeholder="Nova linha de serviço (ex: Tráfego Pago)"
              className="max-w-xs bg-muted text-foreground"
            />
            <Button variant="outline" size="sm" onClick={handleAddLine} disabled={!newLineName.trim()}>
              <Plus className="size-4" /> Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {selectedLine && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={selectClass}>
              {getYearOptions().map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <Badge variant="outline">Faturamento do ano: {formatCurrency(yearRevenue, "BRL")}</Badge>
            <Badge variant="outline">Custo de time do ano: {formatCurrency(yearCost, "BRL")}</Badge>
            <Badge variant={yearRevenue - yearCost >= 0 ? "default" : "destructive"}>
              Margem: {formatCurrency(yearRevenue - yearCost, "BRL")}
            </Badge>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Clientes — {selectedLine.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingClients ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
              ) : clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum cliente nesta linha ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-[220px] bg-card">Descrição</TableHead>
                      {MONTH_SHORT.map((m) => (
                        <TableHead key={m} className="text-right">
                          {m}
                        </TableHead>
                      ))}
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeGroups.map((group) => {
                      const groupTotal = group.clients.reduce(
                        (sum, c) => sum + MONTHS.reduce((s, m) => s + (valueByClientMonth.get(`${c.id}:${m}`) ?? 0), 0),
                        0,
                      );
                      return (
                        <Fragment key={group.key}>
                          {showGroupHeaders && (
                            <TableRow key={`${group.key}-header`} className="bg-muted/60 hover:bg-muted/60">
                              <TableCell
                                colSpan={MONTHS.length + 2}
                                className="sticky left-0 z-10 bg-muted/60 text-xs font-semibold text-foreground"
                              >
                                {group.label ?? "Sem responsável"}
                                <span className="ml-2 font-normal text-muted-foreground">
                                  Faturamento no ano: {formatCurrency(groupTotal, "BRL")}
                                </span>
                              </TableCell>
                            </TableRow>
                          )}
                          {group.clients.map((client) => (
                            <TableRow key={client.id}>
                              <TableCell className="sticky left-0 z-10 bg-card p-0.5">
                                <DescriptionCell
                                  value={client.code ? `${client.code} - ${client.name}` : client.name}
                                  resetKey={`${client.id}-desc-${client.code ?? ""}-${client.name}`}
                                  onSave={(raw) => handleUpdateClientDescription(client, raw)}
                                />
                              </TableCell>
                              {MONTHS.map((m) => (
                                <TableCell key={m} className="p-0.5 text-right">
                                  <MonthCell
                                    value={valueByClientMonth.get(`${client.id}:${m}`)}
                                    resetKey={`${client.id}-${year}-${m}-${valueByClientMonth.get(`${client.id}:${m}`) ?? "e"}`}
                                    onSave={(raw) => handleSaveClientValue(client.id, m, raw)}
                                  />
                                </TableCell>
                              ))}
                              <TableCell className="whitespace-nowrap p-0.5 text-right">
                                <select
                                  value={client.responsible_team_member_id ?? ""}
                                  onChange={(e) => handleSetClientResponsible(client, e.target.value)}
                                  title="Responsável pela conta"
                                  className="h-7 rounded border border-transparent bg-transparent text-xs text-muted-foreground outline-none hover:border-border focus:border-primary"
                                >
                                  <option value="">Sem resp.</option>
                                  {teamMembers.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                                <Button variant="ghost" size="icon-sm" onClick={() => handleToggleClientStatus(client)} title="Encerrar cliente">
                                  <Badge variant="secondary" className="cursor-pointer">
                                    Encerrar
                                  </Badge>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  onClick={() => handleDeleteClient(client)}
                                  className="text-muted-foreground hover:text-red-400"
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </Fragment>
                      );
                    })}

                    {endedClients.length > 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={MONTHS.length + 2}
                          className="bg-muted text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          Encerrados
                        </TableCell>
                      </TableRow>
                    )}
                    {endedClients.map((client) => (
                      <TableRow key={client.id} className="opacity-70">
                        <TableCell className="sticky left-0 z-10 bg-card p-0.5">
                          <DescriptionCell
                            value={client.code ? `${client.code} - ${client.name}` : client.name}
                            resetKey={`${client.id}-desc-${client.code ?? ""}-${client.name}`}
                            onSave={(raw) => handleUpdateClientDescription(client, raw)}
                          />
                        </TableCell>
                        {MONTHS.map((m) => (
                          <TableCell key={m} className="p-0.5 text-right">
                            <MonthCell
                              value={valueByClientMonth.get(`${client.id}:${m}`)}
                              resetKey={`${client.id}-${year}-${m}-${valueByClientMonth.get(`${client.id}:${m}`) ?? "e"}`}
                              onSave={(raw) => handleSaveClientValue(client.id, m, raw)}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="whitespace-nowrap p-0.5 text-right">
                          <Button variant="ghost" size="icon-sm" onClick={() => handleToggleClientStatus(client)} title="Reativar cliente">
                            <Badge variant="default" className="cursor-pointer">
                              Reativar
                            </Badge>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDeleteClient(client)}
                            className="text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Input
                  value={newClientCode}
                  onChange={(e) => setNewClientCode(e.target.value)}
                  placeholder="Código (opcional)"
                  className="w-32 bg-muted text-foreground"
                />
                <Input
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddClient()}
                  placeholder="Nome do cliente"
                  className="max-w-xs flex-1 bg-muted text-foreground"
                />
                <select
                  value={newClientResponsibleId}
                  onChange={(e) => setNewClientResponsibleId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Sem responsável</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={handleAddClient} disabled={!newClientName.trim()}>
                  <Plus className="size-4" /> Adicionar cliente
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">Time / Freelas — {selectedLine.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingAllocations ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
              ) : allocRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma alocação de custo nesta linha ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 min-w-[220px] bg-card">Nome</TableHead>
                      {MONTH_SHORT.map((m) => (
                        <TableHead key={m} className="text-right">
                          {m}
                        </TableHead>
                      ))}
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allocRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="sticky left-0 z-10 whitespace-normal bg-card font-medium text-foreground">
                          {row.label}
                          {row.isFreelancer && <span className="ml-1.5 text-xs text-muted-foreground">(freela)</span>}
                        </TableCell>
                        {MONTHS.map((m) => (
                          <TableCell key={m} className="p-0.5 text-right">
                            <MonthCell
                              value={allocValueByKeyMonth.get(`${row.key}:${m}`)}
                              resetKey={`${row.key}-${year}-${m}-${allocValueByKeyMonth.get(`${row.key}:${m}`) ?? "e"}`}
                              onSave={(raw) => handleSaveAllocationValue(row, m, raw)}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="p-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDeleteAllocationRow(row)}
                            className="text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <select
                  value={newAllocMemberId}
                  onChange={(e) => setNewAllocMemberId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Membro do time…</option>
                  {teamMembers
                    .filter((m) => !allocRows.some((r) => r.teamMemberId === m.id))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <span className="text-xs text-muted-foreground">ou</span>
                <Input
                  value={newAllocFreelancer}
                  onChange={(e) => setNewAllocFreelancer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddAllocationRow()}
                  placeholder="Nome do freela"
                  className="w-40 bg-muted text-foreground"
                />
                <Button variant="outline" size="sm" onClick={handleAddAllocationRow}>
                  <Plus className="size-4" /> Adicionar linha
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
