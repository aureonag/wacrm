"use client";

// ============================================================
// /contracts/[token] — public "aceite virtual" review + sign page.
//
// No auth. Mirrors /join/[token]/page.tsx's peek-then-act shape:
// a GET peek renders the contract for review, then two POSTs
// (send-code, verify-and-accept) carry out the OTP confirmation.
// See src/app/api/contracts/public/[token]/*.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  IdCard,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  User,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ContractDocument } from "@/components/contracts/contract-document";
import { AUREON_PARTY } from "@/lib/contracts/aureon-party";

interface PeekOk {
  ok: true;
  status: "sent" | "viewed" | "signed" | "declined" | "expired" | "cancelled";
  ref_code: string;
  razao_social: string;
  cnpj: string;
  endereco: string;
  nome_representante: string;
  cpf_representante: string;
  rendered_content: string;
  client_email_masked: string;
  signed_at: string | null;
}
interface PeekFail {
  ok: false;
  reason?: "not_found";
}
type PeekResult = PeekOk | PeekFail;

type Step = "review" | "code" | "signed";

interface PartyRow {
  icon: typeof Building2;
  text: string;
}

function PartyCard({ label, rows }: { label: string; rows: PartyRow[] }) {
  return (
    <div className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">{label}</p>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2 text-sm text-neutral-900">
            <row.icon className="mt-0.5 size-3.5 shrink-0 text-neutral-400" />
            <span className="break-words">{row.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContractSignPage() {
  const t = useTranslations("Contracts.public");
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [step, setStep] = useState<Step>("review");
  const [sendingCode, setSendingCode] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const loadPeek = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`/api/contracts/public/${encodeURIComponent(token)}/peek`, {
        cache: "no-store",
      });
      const body = (await res.json()) as PeekResult;
      setPeek(body);
      if (body.ok && body.status === "signed") setStep("signed");
    } catch {
      setPeek({ ok: false });
    }
  }, [token]);

  useEffect(() => {
    loadPeek();
  }, [loadPeek]);

  async function handleRequestCode() {
    if (!token) return;
    setSendingCode(true);
    try {
      const res = await fetch(`/api/contracts/public/${encodeURIComponent(token)}/send-code`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? t("toastCodeFailed"));
        return;
      }
      setStep("code");
    } finally {
      setSendingCode(false);
    }
  }

  async function handleVerify() {
    if (!token || code.length !== 6) return;
    setVerifying(true);
    setCodeError(null);
    try {
      const res = await fetch(`/api/contracts/public/${encodeURIComponent(token)}/verify-and-accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCodeError(body?.error ?? t("toastVerifyFailed"));
        return;
      }
      setStep("signed");
      await loadPeek();
    } finally {
      setVerifying(false);
    }
  }

  if (peek === null) {
    return (
      <Card className="w-full max-w-lg border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        </CardContent>
      </Card>
    );
  }

  if (!peek.ok) {
    return (
      <Card className="w-full max-w-lg border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <AlertTriangle className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-xl text-foreground">{t("notFoundTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">{t("notFoundBody")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (peek.status === "expired" || peek.status === "cancelled" || peek.status === "declined") {
    const copy: Record<string, { title: string; body: string }> = {
      expired: { title: t("expiredTitle"), body: t("expiredBody") },
      cancelled: { title: t("cancelledTitle"), body: t("cancelledBody") },
      declined: { title: t("declinedTitle"), body: t("declinedBody") },
    };
    const { title, body } = copy[peek.status];
    return (
      <Card className="w-full max-w-lg border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl text-foreground">{title}</CardTitle>
          <CardDescription className="text-muted-foreground">{body}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (step === "signed" || peek.status === "signed") {
    return (
      <Card className="w-full max-w-lg border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          </div>
          <CardTitle className="text-xl text-foreground">{t("signedTitle")}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {peek.signed_at
              ? t("signedBodyWithDate", {
                  date: new Date(peek.signed_at).toLocaleString("pt-BR"),
                })
              : t("signedBody")}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-4xl border-neutral-200 bg-white">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-xl text-neutral-900">{t("reviewTitle")}</CardTitle>
        <CardDescription className="text-neutral-500">
          {t("reviewSubtitle")} · Nº {peek.ref_code}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PartyCard
            label={t("labelContratada")}
            rows={[
              { icon: Building2, text: AUREON_PARTY.name },
              { icon: IdCard, text: AUREON_PARTY.cnpj },
              { icon: User, text: AUREON_PARTY.representative },
              { icon: Mail, text: AUREON_PARTY.email },
            ]}
          />
          <PartyCard
            label={t("labelContratante")}
            rows={[
              { icon: Building2, text: peek.razao_social },
              { icon: IdCard, text: peek.cnpj },
              { icon: MapPin, text: peek.endereco },
              { icon: User, text: `${peek.nome_representante} · CPF ${peek.cpf_representante}` },
              { icon: Mail, text: peek.client_email_masked },
            ]}
          />
        </div>

        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <ContractDocument content={peek.rendered_content} hideParties theme="paper" />
        </div>

        {step === "review" ? (
          <Button
            onClick={handleRequestCode}
            disabled={sendingCode}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {sendingCode ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("sendingCode")}
              </>
            ) : (
              <>
                <ShieldCheck className="size-4" />
                {t("confirmAndSign")}
              </>
            )}
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
            <div className="flex items-center gap-2 text-sm text-neutral-900">
              <Mail className="size-4 text-primary" />
              {t("codeSentTo", { email: peek.client_email_masked })}
            </div>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              className="border-neutral-300 bg-white text-center text-lg tracking-[0.5em] text-neutral-900"
            />
            {codeError && <p className="text-xs text-red-600">{codeError}</p>}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleRequestCode}
                disabled={sendingCode}
                className="border-neutral-300 text-neutral-500 hover:bg-neutral-100"
              >
                {t("resendCode")}
              </Button>
              <Button
                onClick={handleVerify}
                disabled={verifying || code.length !== 6}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {verifying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t("verifying")}
                  </>
                ) : (
                  t("verifyAndSign")
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
