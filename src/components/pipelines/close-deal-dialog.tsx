"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Profile, Sector } from "@/types";
import type { ScopeSection } from "@/lib/contracts/scope";
import { SCOPE_TITLES } from "@/lib/tasks/kickoff-briefing";
import { validateFinance } from "@/lib/finance/closing";
import { initialFinanceState, toFinanceInput, type FinanceState } from "@/lib/finance/closing-form";
import { ClosingFinanceStep } from "@/components/pipelines/closing-finance-step";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

interface BoardOption {
  id: string;
  name: string;
}

interface CloseDealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  sectors: Sector[];
  profiles: Profile[];
  defaultAssigneeId: string | null;
  /** True when the deal is already won (signed contract) and only the kickoff is being scheduled. */
  alreadyWon: boolean;
  onClosed: () => void;
}

const NONE = "__none";

function normalizeName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** "Criação" board -> "Criação" sector, "Social Media" board -> "Social" sector, ... */
function suggestSectorId(boardName: string, sectors: Sector[]): string | null {
  const board = normalizeName(boardName);
  const match = sectors.find((s) => {
    const sector = normalizeName(s.name);
    return sector === board || board.includes(sector) || sector.includes(board);
  });
  return match?.id ?? null;
}

export function CloseDealDialog({
  open,
  onOpenChange,
  dealId,
  sectors,
  profiles,
  defaultAssigneeId,
  alreadyWon,
  onClosed,
}: CloseDealDialogProps) {
  const t = useTranslations("Pipelines.closing");

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [boards, setBoards] = useState<BoardOption[]>([]);
  const [serviceLines, setServiceLines] = useState<{ id: string; name: string }[]>([]);
  const [scope, setScope] = useState<ScopeSection[]>([]);
  const [hasSignedContract, setHasSignedContract] = useState(false);
  const [finance, setFinance] = useState<FinanceState | null>(null);

  const [boardId, setBoardId] = useState(NONE);
  const [sectorId, setSectorId] = useState(NONE);
  const [assigneeId, setAssigneeId] = useState(NONE);
  const [observations, setObservations] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep(1);
    setBoardId(NONE);
    setSectorId(NONE);
    setAssigneeId(defaultAssigneeId ?? NONE);
    setObservations("");
    setFinance(null);
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/deals/${dealId}/close`);
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as {
          boards: BoardOption[];
          serviceLines: { id: string; name: string }[];
          monthlyItems: { id: string; label: string | null; value: number }[];
          client: { code: string | null; name: string };
          scope: ScopeSection[];
          hasSignedContract: boolean;
        };
        if (cancelled) return;
        setBoards(data.boards);
        setServiceLines(data.serviceLines);
        setScope(data.scope);
        setHasSignedContract(data.hasSignedContract);
        setFinance(
          data.monthlyItems.length > 0
            ? initialFinanceState({
                client: data.client,
                monthlyItems: data.monthlyItems,
                defaultProfileId: defaultAssigneeId,
              })
            : null,
        );
      } catch {
        if (!cancelled) toast.error(t("toastLoadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dealId, defaultAssigneeId, t]);

  const hasFinance = finance !== null;
  const totalSteps = hasFinance ? 2 : 1;
  const step1Ready = boardId !== NONE && sectorId !== NONE && !loading;

  const financeError = finance
    ? !finance.name.trim()
      ? "invalid_item"
      : validateFinance(toFinanceInput(finance))
    : null;

  const onFinanceStep = hasFinance && step === 2;
  const canSubmit = step1Ready && !submitting && (!hasFinance || (step === 2 && !financeError));

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/deals/${dealId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId,
          sectorId,
          assigneeId: assigneeId === NONE ? null : assigneeId,
          observations,
          finance: finance ? toFinanceInput(finance) : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? t("toastError"));
        return;
      }
      onOpenChange(false);
      onClosed();
    } catch {
      toast.error(t("toastError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl bg-popover border-border text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{alreadyWon ? t("titleKickoff") : t("title")}</DialogTitle>
          {hasFinance && (
            <p className="text-xs text-muted-foreground">
              {t("stepOf", { n: step, total: totalSteps })} · {step === 1 ? t("stepOperational") : t("stepFinance")}
            </p>
          )}
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto py-2 pr-1">
          {onFinanceStep && finance ? (
            <ClosingFinanceStep state={finance} onChange={setFinance} serviceLines={serviceLines} profiles={profiles} />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {alreadyWon
                  ? t("descriptionKickoff")
                  : hasFinance
                    ? t("descriptionWithFinance")
                    : t("description")}
              </p>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">
                  {t("boardLabel")} <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={boardId}
                  onValueChange={(v) => {
                    const next = v ?? NONE;
                    setBoardId(next);
                    if (sectorId === NONE) {
                      const name = boards.find((b) => b.id === next)?.name;
                      const suggested = name ? suggestSectorId(name, sectors) : null;
                      if (suggested) setSectorId(suggested);
                    }
                  }}
                >
                  <SelectTrigger className="w-full bg-muted text-foreground">
                    <SelectValue>{boards.find((b) => b.id === boardId)?.name ?? t("selectPlaceholder")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {boards.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">
                    {t("sectorLabel")} <span className="text-red-400">*</span>
                  </Label>
                  <Select value={sectorId} onValueChange={(v) => setSectorId(v ?? NONE)}>
                    <SelectTrigger className="w-full bg-muted text-foreground">
                      <SelectValue>{sectors.find((s) => s.id === sectorId)?.name ?? t("selectPlaceholder")}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {sectors.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("assigneeLabel")}</Label>
                  <Select value={assigneeId} onValueChange={(v) => setAssigneeId(v ?? NONE)}>
                    <SelectTrigger className="w-full bg-muted text-foreground">
                      <SelectValue>
                        {assigneeId === NONE
                          ? t("noAssignee")
                          : (profiles.find((p) => p.id === assigneeId)?.full_name ?? "")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t("noAssignee")}</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t("scopeTitle")}</Label>
                {loading ? (
                  <div className="rounded-lg border border-border bg-muted/50 p-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : scope.length > 0 ? (
                  <details className="group rounded-lg border border-border bg-muted/50 text-xs text-muted-foreground">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm text-foreground">
                      <span>{t("scopeSummary", { count: scope.length })}</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="space-y-2 border-t border-border px-3 py-2">
                      {scope.map((section) => (
                        <div key={section.key}>
                          <div className="font-semibold text-foreground">{SCOPE_TITLES[section.key]}</div>
                          <ul className="ml-4 list-disc">
                            {section.lines.map((line, i) => (
                              <li key={i}>{line.replace(/^[-*•]\s+/, "")}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    {hasSignedContract ? t("scopeNotFound") : t("scopeNoContract")}
                  </div>
                )}
                {scope.length > 0 && <p className="text-xs text-muted-foreground">{t("scopeHint")}</p>}
              </div>

              <div className="space-y-1.5">
                <Label className="text-muted-foreground">{t("observationsLabel")}</Label>
                <Textarea
                  spellCheck
                  lang="pt-BR"
                  value={observations}
                  onChange={(e) => setObservations(e.target.value)}
                  placeholder={t("observationsPlaceholder")}
                  className="min-h-24 border-border bg-muted text-sm text-foreground"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="bg-popover/50 border-border sm:items-center">
          {!loading && step === 1 && !step1Ready && (
            <p className="mr-auto text-xs text-muted-foreground">{t("requiredHint")}</p>
          )}
          {onFinanceStep && financeError && (
            <p className="mr-auto text-xs text-muted-foreground">{t(`finance.errors.${financeError}`)}</p>
          )}
          {onFinanceStep ? (
            <Button
              variant="outline"
              onClick={() => setStep(1)}
              disabled={submitting}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <ArrowLeft className="mr-1 h-3.5 w-3.5" />
              {t("back")}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
          )}
          {hasFinance && step === 1 ? (
            <Button
              onClick={() => setStep(2)}
              disabled={!step1Ready}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t("next")}
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : alreadyWon ? (
                t("submitKickoff")
              ) : (
                t("submit")
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
