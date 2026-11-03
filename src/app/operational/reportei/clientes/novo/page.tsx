"use client";

// Operacional → Reportei → Clientes → Novo cliente, step 1 of 2: name and the
// report preferences (language, date format, decimal separator), like
// Reportei's "Novo projeto". Continuing creates the client and opens step 2
// (its integrations).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { useAuth } from "@/hooks/use-auth";
import { useHasPermission } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";
import { DATE_FORMATS, DECIMAL_FORMATS, LOCALES, type DateFormat, type DecimalFormat, type Locale } from "@/lib/reportei/client-settings";
import { WizardProgress } from "../../_components/wizard-progress";

function Option({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        selected ? "border-primary bg-primary/5 text-foreground" : "border-border text-muted-foreground hover:bg-muted/50",
      )}
    >
      <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary" : "border-input")}>
        {selected && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      {children}
    </button>
  );
}

export default function ReporteiNewClientPage() {
  const t = useTranslations("Operational.reportei.wizard");
  const router = useRouter();
  const { profileLoading } = useAuth();
  const canEdit = useHasPermission("operational", "tasks", "edit_boards");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [locale, setLocale] = useState<Locale>("pt-BR");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD/MM/YYYY");
  const [decimalFormat, setDecimalFormat] = useState<DecimalFormat>("comma");
  const [saving, setSaving] = useState(false);

  const sample = useMemo(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return { "DD/MM/YYYY": `${dd}/${mm}/${d.getFullYear()}`, "MM/DD/YYYY": `${mm}/${dd}/${d.getFullYear()}` } as Record<DateFormat, string>;
  }, []);

  if (profileLoading) return null;
  if (!canEdit) return <EmptyState title={t("noAccessTitle")} hint={t("noAccessHint")} className="min-h-40" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/operational/reportei/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, code, locale, dateFormat, decimalFormat }),
    });
    if (!res.ok) {
      setSaving(false);
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return toast.error([400, 409].includes(res.status) ? (data?.error ?? t("saveError")) : t("saveError"));
    }
    const { id } = (await res.json()) as { id: string };
    toast.success(t("created"));
    router.push(`/operational/reportei/clientes/${id}?novo=1`);
  }

  return (
    <>
      <Link href="/operational/reportei/clientes" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />
        {t("back")}
      </Link>
      <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>

      <div className="grid gap-8 lg:grid-cols-[16rem_minmax(0,32rem)] lg:gap-14">
        <WizardProgress current={1} total={2} title={t("step1Title")} hint={t("step1Hint")} />

        <form onSubmit={submit} className="space-y-5">
          <h2 className="text-base font-semibold text-foreground">{t("details")}</h2>

          <div className="space-y-1.5">
            <Label htmlFor="rc-name">{t("fieldName")}</Label>
            <Input id="rc-name" value={name} maxLength={200} autoFocus onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rc-code">{t("fieldCode")}</Label>
            <Input id="rc-code" value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>{t("fieldLocale")}</Label>
            <Select value={locale} onValueChange={(v) => v && setLocale(v as Locale)}>
              <SelectTrigger aria-label={t("fieldLocale")} className="h-9 w-full">
                <SelectValue>{t(`locale_${locale}`)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {t(`locale_${l}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label={t("dateFormat")}>
            <Label>{t("dateFormat")}</Label>
            {DATE_FORMATS.map((f) => (
              <Option key={f} selected={dateFormat === f} onClick={() => setDateFormat(f)}>
                {f} ({sample[f]})
              </Option>
            ))}
          </div>

          <div className="space-y-2" role="radiogroup" aria-label={t("decimalFormat")}>
            <Label>{t("decimalFormat")}</Label>
            {DECIMAL_FORMATS.map((f) => (
              <Option key={f} selected={decimalFormat === f} onClick={() => setDecimalFormat(f)}>
                {t(`decimal_${f}`)}
              </Option>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => router.push("/operational/reportei/clientes")} disabled={saving}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("continue")}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
