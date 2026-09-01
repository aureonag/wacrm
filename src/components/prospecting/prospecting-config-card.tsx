"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadPipelines } from "@/lib/pipelines/queries";
import {
  PROSPECTING_DEFAULT_QUANTITY,
  PROSPECTING_MAX_QUANTITY,
  PROSPECTING_MIN_QUANTITY,
  PROSPECTING_QUANTITY_PRESETS,
} from "@/lib/prospecting/constants";
import type { Pipeline, Profile } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ProspectingSelections {
  pipelineId: string;
  ownerId: string;
  frenteLeadgen: boolean;
  frenteAvr: boolean;
  quantity: number;
}

interface ProspectingConfigCardProps {
  selections: ProspectingSelections;
  onChange: (selections: ProspectingSelections) => void;
}

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        selected
          ? "border-primary bg-primary/15 text-primary"
          : "border-border bg-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export function ProspectingConfigCard({ selections, onChange }: ProspectingConfigCardProps) {
  const t = useTranslations("Prospecting.config");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [googleConfigured, setGoogleConfigured] = useState<boolean | null>(null);
  const [customQuantity, setCustomQuantity] = useState("");

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      const [pipelineRows, profileRows] = await Promise.all([
        loadPipelines(supabase),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setPipelines(pipelineRows);
      setProfiles((profileRows.data as Profile[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/prospecting/config", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        setAiConfigured(res.ok ? !!json?.ai_configured : false);
        setGoogleConfigured(res.ok ? !!json?.google_places_configured : false);
      } catch {
        if (!cancelled) {
          setAiConfigured(false);
          setGoogleConfigured(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(partial: Partial<ProspectingSelections>) {
    onChange({ ...selections, ...partial });
  }

  function applyQuantity(raw: number) {
    const clamped = Math.min(PROSPECTING_MAX_QUANTITY, Math.max(PROSPECTING_MIN_QUANTITY, Math.floor(raw) || PROSPECTING_DEFAULT_QUANTITY));
    patch({ quantity: clamped });
  }

  const selectedPipeline = pipelines.find((p) => p.id === selections.pipelineId);
  const selectedOwner = profiles.find((p) => p.user_id === selections.ownerId);

  return (
    <div className="space-y-5">
      {aiConfigured === false && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium text-amber-100">{t("aiNotConfiguredTitle")}</p>
            <p className="mt-0.5 text-amber-200/80">{t("aiNotConfiguredBody")}</p>
            <Link href="/agents?tab=setup" className="mt-1 inline-block font-medium text-amber-100 underline">
              {t("aiNotConfiguredCta")}
            </Link>
          </div>
        </div>
      )}

      {googleConfigured === false && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>{t("googleNotConfiguredBody")}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-muted-foreground">{t("pipelineLabel")}</Label>
        <Select value={selections.pipelineId} onValueChange={(v) => patch({ pipelineId: v as string })}>
          <SelectTrigger className="w-full">
            <SelectValue>{selectedPipeline?.name ?? t("pipelinePlaceholder")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted-foreground">{t("ownerLabel")}</Label>
        <Select value={selections.ownerId} onValueChange={(v) => patch({ ownerId: v as string })}>
          <SelectTrigger className="w-full">
            <SelectValue>{(selectedOwner?.full_name || selectedOwner?.email) ?? t("ownerPlaceholder")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.user_id}>
                {p.full_name || p.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted-foreground">{t("frenteLabel")}</Label>
        <div className="flex flex-wrap gap-2">
          <Chip selected={selections.frenteLeadgen} onClick={() => patch({ frenteLeadgen: !selections.frenteLeadgen })}>
            Lead Generation
          </Chip>
          <Chip selected={selections.frenteAvr} onClick={() => patch({ frenteAvr: !selections.frenteAvr })}>
            E-commerce AVR
          </Chip>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted-foreground">{t("quantityLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {PROSPECTING_QUANTITY_PRESETS.map((n) => (
            <Chip key={n} selected={selections.quantity === n} onClick={() => applyQuantity(n)}>
              {n}
            </Chip>
          ))}
          <Input
            type="number"
            min={PROSPECTING_MIN_QUANTITY}
            max={PROSPECTING_MAX_QUANTITY}
            placeholder={t("quantityCustomPlaceholder")}
            value={customQuantity}
            onChange={(e) => setCustomQuantity(e.target.value)}
            onBlur={() => {
              if (customQuantity.trim()) applyQuantity(Number(customQuantity));
              setCustomQuantity("");
            }}
            className="h-7 w-20 text-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("quantityHint", { quantity: selections.quantity })}</p>
      </div>
    </div>
  );
}
