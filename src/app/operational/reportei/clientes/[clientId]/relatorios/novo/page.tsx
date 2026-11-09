"use client";

// Operacional → Reportei → um cliente → Novo relatório, like Reportei's: step 1 picks
// the template, step 2 the period, the comparison, the integrations and, for each, the
// whole account or some campaigns. "Concluir e gerar relatório" makes the report and
// opens it in the editor. The numbers are made up for now (demo source); when a network
// is connected for real, only the source behind the form changes.

import { Suspense, use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/dashboard/skeleton";
import { CAMPAIGNS, NETWORK_LABEL } from "@/lib/reportei/doc-catalog";
import { demoNetworks } from "@/lib/reportei/client-card";
import { showDate } from "@/lib/reportei/format";
import { resolvePeriod } from "@/lib/reportei/periods";
import { WIZARD_PERIODS, resolveCompare, resolveWizardPeriod, type DateRange, type WizardPeriod } from "@/lib/reportei/wizard";
import { cn } from "@/lib/utils";
import { ClientAvatar } from "../../../../_components/client-avatar";
import { NetworkIcon } from "../../../../_components/network-icon";
import { TemplatePicker, usePickerTemplates } from "../../../../_components/template-picker";
import { WizardProgress } from "../../../../_components/wizard-progress";

const PERIOD_LABEL: Record<WizardPeriod, string> = {
  last_30d: "Últimos 30 dias",
  last_15d: "Últimos 15 dias",
  last_7d: "Últimos 7 dias",
  today: "Hoje",
  last_week: "Última Semana",
  this_month: "Este mês",
  last_month: "Último Mês",
  last_quarter: "Último Trimestre",
};

// Local-only preview, same switch as the clients grid: the networks a client "has" are made up.
const DEMO_ICONS = process.env.NEXT_PUBLIC_REPORTEI_DEMO_ICONS === "1";
const DEMO_NETWORKS = ["instagram_business", "facebook", "meta_ads", "google_ads", "tiktok_ads", "google_analytics_4", "youtube", "tiktok", "linkedin"];

interface ClientInfo {
  id: string;
  name: string;
  logoUrl: string | null;
}

interface Account {
  key: string;
  network: string;
  /** Label only. */
  name: string;
  /** The linked account's id (act_…): what the server uses to pick the account. Absent for the preview networks. */
  accountId?: string;
}

interface ClientResponse {
  client: ClientInfo;
  integrations: { provider: string; external_account_id: string; external_account_name: string | null }[];
}

function CampaignsDialog({ account, selected, onClose, onSave }: { account: Account; selected: string[]; onClose: () => void; onSave: (picked: string[]) => void }) {
  const [picked, setPicked] = useState(new Set(selected));
  const toggle = (c: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Campanhas de {account.name}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Escolha as campanhas do relatório. Sem nenhuma marcada, o relatório usa a conta toda.</p>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {CAMPAIGNS.map((c) => (
            <li key={c}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                <input type="checkbox" checked={picked.has(c)} onChange={() => toggle(c)} className="h-4 w-4 accent-primary" />
                {c}
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave([...picked])}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function NewReportPage({ params }: { params: Promise<{ clientId: string }> }) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-96 max-w-5xl" />}>
      <NewReport params={params} />
    </Suspense>
  );
}

// Each template has its own address (?template=...), like Reportei's /report/new/<template>:
// "Continuar" goes to it, "Voltar" and the browser's back button return to the list.
function NewReport({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = use(params);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { items, failed } = usePickerTemplates();
  const urlTemplate = search.get("template");
  const step: 1 | 2 = urlTemplate ? 2 : 1;
  const [pickedId, setTemplateId] = useState<string | null>("builtin:padrao");
  const templateId = urlTemplate ?? pickedId;
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [campaigns, setCampaigns] = useState<Record<string, string[]>>({});
  const [choosing, setChoosing] = useState<Account | null>(null);
  const [period, setPeriod] = useState<WizardPeriod | "custom">("last_30d");
  const [custom, setCustom] = useState<DateRange>({ since: "", until: "" });
  const [compare, setCompare] = useState<"previous" | "none" | "custom">("previous");
  const [compareCustom, setCompareCustom] = useState<DateRange>({ since: "", until: "" });
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = resolvePeriod("last_7d").until;

  useEffect(() => {
    let alive = true;
    fetch(`/api/operational/reportei/clients/${clientId}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) return setLoadError(true);
        const data = (await res.json()) as ClientResponse;
        setClient(data.client);
        const real: Account[] = data.integrations
          .filter((i) => i.provider === "meta_ads")
          .map((i) => ({ key: `meta_ads:${i.external_account_id}`, network: "meta_ads", name: i.external_account_name ?? i.external_account_id, accountId: i.external_account_id }));
        // Local preview: the client "has" a mix of networks, so every template can be tried.
        const made: Account[] = DEMO_ICONS
          ? demoNetworks(data.client.name, DEMO_NETWORKS)
              .filter((n) => !real.some((r) => r.network === n))
              .map((n) => ({ key: `${n}:demo`, network: n, name: data.client.name }))
          : [];
        const all = [...real, ...made];
        setAccounts(all);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const range = useMemo<DateRange | null>(() => {
    if (period === "custom") return custom.since && custom.until && custom.since <= custom.until && custom.until <= today ? custom : null;
    return resolveWizardPeriod(period, today);
  }, [period, custom, today]);

  const previous = range ? resolveCompare("previous", range, today) : null;
  const compareRange = compare === "custom" ? (compareCustom.since && compareCustom.until ? resolveCompare(compareCustom, range ?? { since: today, until: today }, today) : undefined) : null;
  const compareOk = compare !== "custom" || !!compareRange;

  const chosen = accounts.filter((a) => selected.has(a.key));
  const canFinish = !!range && compareOk && chosen.length > 0 && !saving;

  async function generate(demo = false) {
    if (!range || !templateId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/operational/reportei/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          templateId,
          period: period === "custom" ? range : period,
          compare: compare === "custom" ? compareRange : compare,
          integrations: chosen.map((a) => ({ network: a.network, account: a.name, ...(a.accountId ? { accountId: a.accountId } : {}), campaigns: campaigns[a.key]?.length ? campaigns[a.key] : null })),
          ...(demo ? { demo: true } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string; skipped?: string[]; unreadable?: { account: string }[] } | null;
      if (!res.ok || !body?.id) {
        if (res.status === 404) return toast.error("Esse template não está disponível.");
        if (body?.error === "no_real_source") return toast.error("Só a Meta Ads tem dados reais por enquanto. Escolha uma conta Meta Ads ou gere o modelo com números fictícios.");
        if (body?.error === "unreadable") return toast.error("Não foi possível ler a Meta agora. Nenhum relatório foi criado.");
        if (body?.error === "unknown_account" || body?.error === "account_id_required") return toast.error("A conta escolhida não está mais ligada a este cliente.");
        if (body?.error === "unknown_campaign") return toast.error("Alguma campanha escolhida não existe mais nessa conta. Escolha de novo.");
        if (body?.error === "connection_unavailable") return toast.error("A conexão com a Meta dessa conta não está disponível. Reconecte em Integrações.");
        if (body?.error === "nothing_to_show") return toast.error("O template não tem nenhum indicador de Meta Ads para mostrar.");
        return toast.error("Não foi possível gerar o relatório.");
      }
      if (!demo && body.skipped && body.skipped.length > 0) toast.message("Redes sem dados reais ainda ficaram de fora do relatório.");
      if (body.unreadable && body.unreadable.length > 0) toast.warning(`Não foi possível ler: ${body.unreadable.map((u) => u.account).join(", ")}.`);
      router.push(`/operational/reportei/relatorios/${body.id}`);
    } catch {
      toast.error("Não foi possível gerar o relatório.");
    } finally {
      setSaving(false);
    }
  }

  const template = items?.find((t) => t.id === templateId) ?? null;

  // The template decides which integrations come ticked: the networks it has blocks for.
  // A client with none of them gets everything ticked, as in Reportei.
  const templateNetworks = useMemo(() => [...new Set((template?.layout?.blocks ?? []).map((b) => b.network))], [template]);
  useEffect(() => {
    if (accounts.length === 0) return;
    const fit = accounts.filter((a) => templateNetworks.includes(a.network));
    setSelected(new Set((fit.length ? fit : accounts).map((a) => a.key)));
  }, [accounts, templateNetworks]);
  const missingNetworks = templateNetworks.filter((n) => !accounts.some((a) => a.network === n));
  // Clicking a template goes straight into it (step 2), like Reportei.
  function pick(id: string) {
    const t = items?.find((x) => x.id === id);
    setTemplateId(id);
    if (t && (t.group === "reportei" || t.layout)) router.push(`${pathname}?template=${encodeURIComponent(id)}`);
  }
  const back =`/operational/reportei/clientes/${clientId}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Voltar para {client?.name ?? "o cliente"}
        </Link>
        {step === 1 && (
          <Link href="/operational/reportei/templates" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <Settings className="h-4 w-4" />
            Gerenciar templates
          </Link>
        )}
      </div>

      {loadError && <p className="text-sm text-red-500">Não foi possível carregar o cliente.</p>}

      <div className="grid items-start gap-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-14">
        <div className="space-y-8">
          <div className="flex items-center gap-4">
            {client && <ClientAvatar name={client.name} logoUrl={client.logoUrl} size={56} />}
            <h1 className="text-2xl font-bold text-primary">Novo relatório</h1>
          </div>
        {step === 1 ? (
          <WizardProgress side current={1} total={2} title="Templates" hint="Escolha um template para o seu relatório." />
        ) : (
          <div className="space-y-4">
            <WizardProgress side current={2} total={2} title="Dados do Relatório" hint="Preencha os dados relacionados ao seu relatório." />
            {template && (
              <div className="rounded-xl border border-border bg-card p-3 text-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Template</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">{template.name}</p>
                {template.description && <p className="mt-1 text-muted-foreground">{template.description}</p>}
              </div>
            )}
          </div>
        )}
        </div>

        {step === 1 ? (
          <div className="space-y-6 lg:pt-2">
            <TemplatePicker items={items} value={templateId} onChange={pick} />
            {failed && <p className="text-xs text-red-500">Não foi possível carregar os seus templates.</p>}
            {template && template.group !== "reportei" && !template.layout && <p className="text-right text-xs text-muted-foreground">Este template é do modelo antigo (só escolhe métricas) e não gera relatório em blocos.</p>}
          </div>
        ) : (
          <div className="space-y-8">
            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Período de análise</h2>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as WizardPeriod | "custom")}
                aria-label="Período de análise"
                className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm text-foreground dark:bg-input/30"
              >
                {WIZARD_PERIODS.map((p) => {
                  const r = resolveWizardPeriod(p, today);
                  return (
                    <option key={p} value={p}>
                      {PERIOD_LABEL[p]} ({showDate(r.since)} a {showDate(r.until)})
                    </option>
                  );
                })}
                <option value="custom">Período personalizado</option>
              </select>
              {period === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <Input type="date" aria-label="De" value={custom.since} max={today} onChange={(e) => setCustom((c) => ({ ...c, since: e.target.value }))} />
                  <Input type="date" aria-label="Até" value={custom.until} max={today} onChange={(e) => setCustom((c) => ({ ...c, until: e.target.value }))} />
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Período de comparação</h2>
              {(
                [
                  ["previous", previous ? `Comparar com o mesmo período anterior (${showDate(previous.since)} a ${showDate(previous.until)})` : "Comparar com o mesmo período anterior"],
                  ["none", "Não comparar com nenhum período"],
                  ["custom", "Comparar com um período personalizado"],
                ] as const
              ).map(([value, text]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
                  <input type="radio" name="compare" checked={compare === value} onChange={() => setCompare(value)} className="accent-primary" />
                  {text}
                </label>
              ))}
              {compare === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <Input type="date" aria-label="Comparar de" value={compareCustom.since} max={today} onChange={(e) => setCompareCustom((c) => ({ ...c, since: e.target.value }))} />
                  <Input type="date" aria-label="Comparar até" value={compareCustom.until} max={today} onChange={(e) => setCompareCustom((c) => ({ ...c, until: e.target.value }))} />
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-xl font-semibold text-primary">Integrações</h2>
              {accounts.length === 0 ? (
                client ? (
                  <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                    Este cliente ainda não tem integrações.{" "}
                    <Link href={back} className="font-medium text-primary hover:underline">
                      Ligue uma conta de anúncios
                    </Link>{" "}
                    para gerar o relatório.
                  </p>
                ) : (
                  <Skeleton className="h-24" />
                )
              ) : (
                <>
                  <button type="button" onClick={() => setSelected(new Set())} className="w-full rounded-xl border border-border py-3 text-sm font-medium text-primary transition-colors hover:bg-muted/40">
                    Desfazer seleção
                  </button>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {accounts.map((a) => {
                      const on = selected.has(a.key);
                      return (
                        <button
                          key={a.key}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(a.key)) next.delete(a.key);
                              else next.add(a.key);
                              return next;
                            })
                          }
                          className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors", on ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted/40")}
                        >
                          <NetworkIcon network={a.network} size={20} />
                          <span className="min-w-0">
                            <span className="block truncate">{a.name}</span>
                            <span className="block text-[11px] font-normal text-muted-foreground">{NETWORK_LABEL[a.network]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {accounts.length > 0 && missingNetworks.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Este template também tem blocos de {missingNetworks.map((n) => NETWORK_LABEL[n] ?? n).join(", ")}. O cliente ainda não tem essas integrações, então esses blocos ficam de fora.
                </p>
              )}
              <Link href={back} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-3 text-sm font-medium text-primary transition-colors hover:bg-muted/40">
                <Plus className="h-4 w-4" />
                Adicionar nova integração
              </Link>
            </section>

            {chosen.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xl font-semibold text-primary">Escolher detalhes</h2>
                <p className="text-sm text-muted-foreground">
                  As redes abaixo permitem que você gere uma <b className="text-foreground">análise geral</b> (toda a conta) ou uma <b className="text-foreground">análise detalhada</b> (por campanha, pipeline, unidade, etc). Você pode editá-los abaixo para escolher o tipo de análise que deseja.
                </p>
                <ul className="space-y-2">
                  {chosen.map((a) => (
                    <li key={a.key} className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-3">
                        <NetworkIcon network={a.network} size={28} />
                        <span>
                          <span className="block text-sm font-semibold text-foreground">{a.name}</span>
                          <span className="block text-xs text-muted-foreground">{campaigns[a.key]?.length ? `${campaigns[a.key].length} ${campaigns[a.key].length === 1 ? "campanha selecionada" : "campanhas selecionadas"}.` : "Toda a conta."}</span>
                        </span>
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setChoosing(a)}>
                        Selecionar campanhas
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="flex items-center justify-between border-t border-border pt-5">
              <Button variant="outline" onClick={() => router.push(pathname)}>
                Voltar
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={!canFinish} onClick={() => void generate(true)} title="Gera um relatório de exemplo com números fictícios, marcado como modelo. Não pode ser compartilhado.">
                  Gerar modelo fictício
                </Button>
                <Button disabled={!canFinish} onClick={() => void generate()}>
                  {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Concluir e gerar relatório
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {choosing && (
        <CampaignsDialog
          account={choosing}
          selected={campaigns[choosing.key] ?? []}
          onClose={() => setChoosing(null)}
          onSave={(picked) => {
            setCampaigns((prev) => ({ ...prev, [choosing.key]: picked }));
            setChoosing(null);
          }}
        />
      )}
    </div>
  );
}
