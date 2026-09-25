"use client";

import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import type { Profile } from "@/types";
import { formatCurrency } from "@/lib/currency";
import { firstMonthTotal, splitCommission } from "@/lib/finance/closing";
import {
  newKey,
  toFinanceInput,
  type CommissionState,
  type FinanceItemState,
  type FinanceState,
} from "@/lib/finance/closing-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

interface ClosingFinanceStepProps {
  state: FinanceState;
  onChange: (next: FinanceState) => void;
  serviceLines: { id: string; name: string }[];
  profiles: Profile[];
}

const NONE = "__none";

export function ClosingFinanceStep({ state, onChange, serviceLines, profiles }: ClosingFinanceStepProps) {
  const t = useTranslations("Pipelines.closing.finance");

  const input = toFinanceInput(state);
  const amountsOk = input.items.every((i) => Number.isFinite(i.amount) && i.amount > 0 && (i.promoMonths === 0 || Number.isFinite(i.promoAmount)));
  const base = state.firstPaymentDate && amountsOk ? firstMonthTotal(input) : 0;
  const pctOk = input.commissions.every((c) => Number.isFinite(c.pct) && c.pct > 0);
  const pctTotal = input.commissions.reduce((sum, c) => sum + (Number.isFinite(c.pct) ? c.pct : 0), 0);
  const shares = pctOk && Math.abs(pctTotal - 100) <= 0.01 ? splitCommission(base, input.commissions) : [];

  const setItem = (key: string, patch: Partial<FinanceItemState>) =>
    onChange({ ...state, items: state.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  const setCommission = (key: string, patch: Partial<CommissionState>) =>
    onChange({ ...state, commissions: state.commissions.map((c) => (c.key === key ? { ...c, ...patch } : c)) });

  const usedProfiles = new Set(state.commissions.map((c) => c.profileId));
  const profileName = (id: string) => profiles.find((p) => p.id === id)?.full_name ?? "";

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr]">
        <div className="space-y-1.5">
          <Label className="text-muted-foreground">{t("clientCode")}</Label>
          <Input
            value={state.code}
            onChange={(e) => onChange({ ...state, code: e.target.value })}
            className="border-border bg-muted text-foreground"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-muted-foreground">
            {t("clientName")} <span className="text-red-400">*</span>
          </Label>
          <Input
            value={state.name}
            onChange={(e) => onChange({ ...state, name: e.target.value })}
            className="border-border bg-muted text-foreground"
          />
        </div>
      </div>

      <div className="space-y-3">
        {state.items.map((item) => (
          <div key={item.key} className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            {item.label && <div className="text-sm font-medium text-foreground">{item.label}</div>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">
                  {t("serviceLine")} <span className="text-red-400">*</span>
                </Label>
                <Select
                  value={item.serviceLineId || NONE}
                  onValueChange={(v) => setItem(item.key, { serviceLineId: v && v !== NONE ? v : "" })}
                >
                  <SelectTrigger className="w-full bg-muted text-foreground">
                    <SelectValue>
                      {serviceLines.find((l) => l.id === item.serviceLineId)?.name ?? t("select")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {serviceLines.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">
                  {t("monthlyValue")} <span className="text-red-400">*</span>
                </Label>
                <Input
                  inputMode="decimal"
                  value={item.amount}
                  onChange={(e) => setItem(item.key, { amount: e.target.value })}
                  placeholder="0,00"
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={item.promo}
                onChange={(e) => setItem(item.key, { promo: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              {t("promoToggle")}
            </label>
            {item.promo && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("promoMonths")}</Label>
                  <Input
                    inputMode="numeric"
                    value={item.promoMonths}
                    onChange={(e) => setItem(item.key, { promoMonths: e.target.value.replace(/\D/g, "") })}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-muted-foreground">{t("promoAmount")}</Label>
                  <Input
                    inputMode="decimal"
                    value={item.promoAmount}
                    onChange={(e) => setItem(item.key, { promoAmount: e.target.value })}
                    placeholder="0,00"
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted-foreground">
          {t("firstPayment")} <span className="text-red-400">*</span>
        </Label>
        <Input
          type="date"
          value={state.firstPaymentDate}
          onChange={(e) => onChange({ ...state, firstPaymentDate: e.target.value })}
          className="w-full border-border bg-muted text-foreground sm:w-56"
        />
        <p className="text-xs text-muted-foreground">{t("firstPaymentHint")}</p>
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground">{t("commissionTitle")}</Label>
        <p className="text-xs text-muted-foreground">
          {base > 0 ? t("commissionHint", { base: formatCurrency(base, "BRL") }) : t("commissionHintEmpty")}
        </p>
        <div className="space-y-2">
          {state.commissions.map((c, index) => (
            <div key={c.key} className="flex items-center gap-2">
              <Select
                value={c.profileId || NONE}
                onValueChange={(v) => setCommission(c.key, { profileId: v && v !== NONE ? v : "" })}
              >
                <SelectTrigger className="min-w-0 flex-1 bg-muted text-foreground">
                  <SelectValue>{profileName(c.profileId) || t("person")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {profiles
                    .filter((p) => p.id === c.profileId || !usedProfiles.has(p.id))
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <div className="relative w-24 shrink-0">
                <Input
                  inputMode="decimal"
                  value={c.pct}
                  onChange={(e) => setCommission(c.key, { pct: e.target.value })}
                  className="border-border bg-muted pr-6 text-right text-foreground"
                />
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  %
                </span>
              </div>
              <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground sm:block">
                {shares[index] ? formatCurrency(shares[index].amount, "BRL") : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange({ ...state, commissions: state.commissions.filter((x) => x.key !== c.key) })}
                title={t("removePerson")}
                className="shrink-0 text-muted-foreground hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={usedProfiles.size >= profiles.length}
            onClick={() =>
              onChange({
                ...state,
                commissions: [
                  ...state.commissions,
                  { key: newKey(), profileId: "", pct: state.commissions.length === 0 ? "100" : "" },
                ],
              })
            }
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("addPerson")}
          </Button>
          {state.commissions.length > 0 && (
            <span
              className={`text-xs ${Math.abs(pctTotal - 100) <= 0.01 ? "text-emerald-400" : "text-amber-400"}`}
            >
              {t("percentTotal", { total: Number.isFinite(pctTotal) ? Math.round(pctTotal * 100) / 100 : 0 })}
            </span>
          )}
        </div>
        {state.commissions.length === 0 && <p className="text-xs text-muted-foreground">{t("noCommission")}</p>}
      </div>
    </div>
  );
}

