"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import type { DealLineItemType, PipelineStage, Profile } from "@/types";
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

interface DealCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
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

export function DealCreateModal({
  open,
  onOpenChange,
  pipelineId,
  stages,
  defaultStageId,
  onSaved,
}: DealCreateModalProps) {
  const t = useTranslations("Pipelines.createModal");
  const tOrigin = useTranslations("Pipelines.origin");
  const supabase = createClient();
  const { user, profile, accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [changingResponsible, setChangingResponsible] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [segment, setSegment] = useState("");
  const [region, setRegion] = useState("");
  const [origin, setOrigin] = useState("");
  const [originOther, setOriginOther] = useState("");
  const [stageId, setStageId] = useState("");
  const [frenteLeadgen, setFrenteLeadgen] = useState(false);
  const [frenteAvr, setFrenteAvr] = useState(false);
  const [valueType, setValueType] = useState<DealLineItemType>("mensal");
  const [value, setValue] = useState("");
  const [contactName, setContactName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setResponsibleId(profile?.id ?? "");
    setChangingResponsible(false);
    setSegment("");
    setRegion("");
    setOrigin("");
    setOriginOther("");
    setStageId(defaultStageId || stages[0]?.id || "");
    setFrenteLeadgen(false);
    setFrenteAvr(false);
    setValueType("mensal");
    setValue("");
    setContactName("");
    setWhatsapp("");
    setEmail("");
    setWebsite("");
    setInstagram("");
  }, [open, profile?.id, defaultStageId, stages]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").order("full_name");
      if (!cancelled) setProfiles((data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  const responsibleLabel =
    profiles.find((p) => p.id === responsibleId)?.full_name ||
    profiles.find((p) => p.id === responsibleId)?.email ||
    profile?.full_name ||
    profile?.email ||
    "";

  async function handleCreate() {
    if (!title.trim() || !whatsapp.trim()) {
      toast.error(t("toastRequired"));
      return;
    }
    if (!user || !accountId) return;
    setSaving(true);

    let contactId: string;
    const existing = await findExistingContact(supabase, accountId, whatsapp.trim());
    if (existing) {
      contactId = existing.id;
    } else {
      const { data: newContact, error: contactError } = await supabase
        .from("contacts")
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: contactName.trim() || title.trim(),
          phone: whatsapp.trim(),
          email: email.trim() || null,
          website: website.trim() || null,
          instagram: instagram.trim() || null,
        })
        .select()
        .single();

      if (contactError || !newContact) {
        // Racing insert may have just created the same contact — fall
        // back to the dedup lookup instead of failing the whole deal.
        if (isUniqueViolation(contactError)) {
          const retry = await findExistingContact(supabase, accountId, whatsapp.trim());
          if (retry) {
            contactId = retry.id;
          } else {
            toast.error(t("toastFailedCreate"));
            setSaving(false);
            return;
          }
        } else {
          toast.error(t("toastFailedCreate"));
          setSaving(false);
          return;
        }
      } else {
        contactId = newContact.id;
      }
    }

    const numericValue = parseFloat(value) || 0;

    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .insert({
        user_id: user.id,
        account_id: accountId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
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
      toast.error(t("toastFailedCreate"));
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
    toast.success(t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-popover border-border text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          <div className="grid gap-2">
            <Label className="text-muted-foreground">{t("dealName")}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("dealNamePlaceholder")}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("initialStage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
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
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder={t("whatsappPlaceholder")}
                className="border-border bg-muted text-foreground"
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
            {t("cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={saving || !title.trim() || !whatsapp.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? t("creating") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
