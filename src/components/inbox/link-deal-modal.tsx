"use client";

// LinkConversationToDealModal — Inbox → "Vincular a um pipeline" (Fase 3
// do plano de WhatsApp pessoal). Reaproveita o mesmo conjunto de campos
// do DealCreateModal (src/components/pipelines/deal-create-modal.tsx),
// mas parte de um contato JA existente (o da conversa) em vez de criar
// um novo, e deixa o agente escolher o pipeline (o DealCreateModal
// assume que o pipeline ja foi escolhido pela tela que o abre). Ao
// salvar, grava deals.conversation_id (coluna ja existente desde a
// 001_initial_schema.sql) — nenhuma migracao nova.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadPipelines, loadPipelineStages } from "@/lib/pipelines/queries";
import type { Contact, DealLineItemType, Pipeline, PipelineStage, Profile } from "@/types";
import { DEAL_ORIGIN_KEYS } from "@/lib/deals/origin";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

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

interface LinkDealModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  contact: Contact;
  onSaved: () => void;
}

export function LinkDealModal({
  open,
  onOpenChange,
  conversationId,
  contact,
  onSaved,
}: LinkDealModalProps) {
  const t = useTranslations("Pipelines.createModal");
  const tOrigin = useTranslations("Pipelines.origin");
  const tLink = useTranslations("Inbox.linkDeal");
  const supabase = createClient();
  const { user, profile, accountId, defaultCurrency } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [stageId, setStageId] = useState("");

  const [title, setTitle] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [changingResponsible, setChangingResponsible] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [segment, setSegment] = useState("");
  const [region, setRegion] = useState("");
  const [origin, setOrigin] = useState("");
  const [originOther, setOriginOther] = useState("");
  const [frenteLeadgen, setFrenteLeadgen] = useState(false);
  const [frenteAvr, setFrenteAvr] = useState(false);
  const [valueType, setValueType] = useState<DealLineItemType>("mensal");
  const [value, setValue] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setPipelineId("");
    setStages([]);
    setStageId("");
    setTitle(contact.name || contact.phone || "");
    setResponsibleId(profile?.id ?? "");
    setChangingResponsible(false);
    setSegment("");
    setRegion("");
    setOrigin("");
    setOriginOther("");
    setFrenteLeadgen(false);
    setFrenteAvr(false);
    setValueType("mensal");
    setValue("");
    setContactName(contact.name ?? "");
    setEmail(contact.email ?? "");
    setWebsite(contact.website ?? "");
    setInstagram(contact.instagram ?? "");
  }, [open, contact, profile?.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [pipelineRows, profileRows] = await Promise.all([
        loadPipelines(supabase),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setPipelines(pipelineRows);
      setProfiles((profileRows.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  async function handlePipelineChange(id: string) {
    setPipelineId(id);
    setStageId("");
    if (!id) {
      setStages([]);
      return;
    }
    const rows = await loadPipelineStages(supabase, id);
    setStages(rows);
    setStageId(rows[0]?.id ?? "");
  }

  const responsibleLabel =
    profiles.find((p) => p.id === responsibleId)?.full_name ||
    profiles.find((p) => p.id === responsibleId)?.email ||
    profile?.full_name ||
    profile?.email ||
    "";

  async function handleLink() {
    if (!title.trim() || !pipelineId || !stageId) {
      toast.error(tLink("toastRequired"));
      return;
    }
    if (!user || !accountId) return;
    setSaving(true);

    // Existing contact — update in place rather than find-or-create.
    await supabase
      .from("contacts")
      .update({
        name: contactName.trim() || contact.name || null,
        email: email.trim() || null,
        website: website.trim() || null,
        instagram: instagram.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id);

    const numericValue = parseFloat(value) || 0;

    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .insert({
        user_id: user.id,
        account_id: accountId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contact.id,
        conversation_id: conversationId,
        assigned_to: responsibleId || null,
        title: title.trim(),
        value: numericValue,
        currency: defaultCurrency,
        segment: segment.trim() || null,
        region: region.trim() || null,
        frente_leadgen: frenteLeadgen,
        frente_avr: frenteAvr,
        origin: origin === "other" ? originOther.trim() || "other" : origin || null,
        status: "open",
      })
      .select()
      .single();

    if (dealError || !deal) {
      toast.error(tLink("toastFailed"));
      setSaving(false);
      return;
    }

    if (numericValue > 0) {
      await supabase.from("deal_line_items").insert({
        deal_id: deal.id,
        account_id: accountId,
        type: valueType,
        value: numericValue,
      });
    }

    setSaving(false);
    toast.success(tLink("toastLinked"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{tLink("title")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{tLink("pipeline")}</Label>
              <select
                value={pipelineId}
                onChange={(e) => handlePipelineChange(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{tLink("pipelinePlaceholder")}</option>
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("initialStage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                disabled={!pipelineId}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("dealName")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("dealNamePlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("responsible")}</Label>
            {changingResponsible ? (
              <select
                autoFocus
                value={responsibleId}
                onChange={(e) => {
                  setResponsibleId(e.target.value);
                  setChangingResponsible(false);
                }}
                onBlur={() => setChangingResponsible(false)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setChangingResponsible(true)}
                className="flex h-9 items-center justify-between rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground hover:bg-muted/70"
              >
                <span className="truncate">{responsibleLabel}</span>
                <span className="ml-2 shrink-0 text-xs text-primary">{t("changeResponsible")}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("segment")}</Label>
              <Input
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
                placeholder={t("segmentPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("region")}</Label>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder={t("regionPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{tOrigin("label")}</Label>
            <select
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{tOrigin("placeholder")}</option>
              {DEAL_ORIGIN_KEYS.map((key) => (
                <option key={key} value={key}>
                  {tOrigin(key)}
                </option>
              ))}
            </select>
            {origin === "other" && (
              <Input
                value={originOther}
                onChange={(e) => setOriginOther(e.target.value)}
                placeholder={tOrigin("otherPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            )}
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("frente")}</Label>
            <div className="flex gap-2">
              <Chip selected={frenteLeadgen} onClick={() => setFrenteLeadgen((v) => !v)}>
                {t("frenteLeadgen")}
              </Chip>
              <Chip selected={frenteAvr} onClick={() => setFrenteAvr((v) => !v)}>
                {t("frenteAvr")}
              </Chip>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("valueType")}</Label>
              <div className="flex gap-2">
                <Chip selected={valueType === "mensal"} onClick={() => setValueType("mensal")}>
                  {t("mensal")}
                </Chip>
                <Chip selected={valueType === "pontual"} onClick={() => setValueType("pontual")}>
                  {t("pontual")}
                </Chip>
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("value")}</Label>
              <Input
                type="number"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("valuePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("contactName")}</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder={t("contactNamePlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("whatsapp")}</Label>
              <Input
                value={contact.phone}
                disabled
                className="border-border bg-muted text-foreground opacity-70"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("email")}</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("website")}</Label>
              <Input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder={t("websitePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("instagram")}</Label>
              <Input
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder={t("instagramPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="bg-popover/50 border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {tLink("cancel")}
          </Button>
          <Button
            onClick={handleLink}
            disabled={saving || !title.trim() || !pipelineId || !stageId}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? tLink("saving") : tLink("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
