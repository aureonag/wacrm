"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ClipboardCopy, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildClaudeResearchPrompt, type ProspectingFrente } from "@/lib/prospecting/claude-assisted-prompt";
import type { ProspectingSelections } from "./prospecting-config-card";

interface ProspectingExternalImportProps {
  selections: ProspectingSelections;
  onRunStarted: (runId: string) => void;
}

function deriveFrente(selections: ProspectingSelections): ProspectingFrente | null {
  if (selections.frenteAvr && !selections.frenteLeadgen) return "avr";
  if (selections.frenteLeadgen && !selections.frenteAvr) return "leadgen";
  return null; // neither or both selected — ambiguous, let the user pick one first
}

export function ProspectingExternalImport({ selections, onRunStarted }: ProspectingExternalImportProps) {
  const t = useTranslations("Prospecting.external");
  const [niche, setNiche] = useState("");
  const [region, setRegion] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasPipeline = !!selections.pipelineId;
  const frente = deriveFrente(selections);

  function handleCopyPrompt() {
    if (!frente) {
      toast.error(t("selectOneFrenteFirst"));
      return;
    }
    const prompt = buildClaudeResearchPrompt({ frente, niche, region, quantity: selections.quantity });
    navigator.clipboard
      .writeText(prompt)
      .then(() => toast.success(t("promptCopied")))
      .catch(() => toast.error(t("promptCopyFailed")));
  }

  async function submitRun(body: FormData | Record<string, unknown>) {
    setSubmitting(true);
    try {
      const isForm = body instanceof FormData;
      const res = await fetch("/api/prospecting/runs/external", {
        method: "POST",
        headers: isForm ? undefined : { "Content-Type": "application/json" },
        body: isForm ? body : JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(json?.error ?? t("importFailed"));
        return;
      }
      onRunStarted(json.run_id as string);
      setDialogOpen(false);
      setPastedText("");
      setFile(null);
      toast.success(
        t("importSuccess", { inserted: json.inserted_count ?? 0, skipped: json.skipped_count ?? 0 }),
      );
      for (const warning of (json.warnings as string[] | undefined) ?? []) {
        toast.warning(warning);
      }
    } catch {
      toast.error(t("importFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmitPaste() {
    if (!pastedText.trim()) return;
    void submitRun({
      pasted_text: pastedText,
      pipeline_id: selections.pipelineId,
      owner_id: selections.ownerId || null,
      frente_leadgen: selections.frenteLeadgen,
      frente_avr: selections.frenteAvr,
    });
  }

  function handleSubmitUpload() {
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("pipeline_id", selections.pipelineId);
    if (selections.ownerId) form.set("owner_id", selections.ownerId);
    form.set("frente_leadgen", String(selections.frenteLeadgen));
    form.set("frente_avr", String(selections.frenteAvr));
    void submitRun(form);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/60 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{t("title")}</p>
        <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {!hasPipeline && <p className="text-xs text-amber-300">{t("selectPipelineFirst")}</p>}

      <div className="grid gap-1.5 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("nicheLabel")}</Label>
          <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t("nichePlaceholder")} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">{t("regionLabel")}</Label>
          <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t("regionPlaceholder")} className="h-8 text-xs" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleCopyPrompt} disabled={!hasPipeline}>
          <ClipboardCopy className="h-3.5 w-3.5" />
          {t("copyPromptButton")}
        </Button>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button type="button" variant="outline" size="sm" disabled={!hasPipeline} />}>
            <Upload className="h-3.5 w-3.5" />
            {t("importButton")}
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("importDialogTitle")}</DialogTitle>
            </DialogHeader>

            <Tabs defaultValue="paste">
              <TabsList>
                <TabsTrigger value="paste">{t("pasteTab")}</TabsTrigger>
                <TabsTrigger value="upload">{t("uploadTab")}</TabsTrigger>
              </TabsList>

              <TabsContent value="paste" className="space-y-3 pt-3">
                {/* The scrollbar this needs (see the Textarea comment below)
                    would otherwise square off the rounded corners where it
                    meets the border — clipping it at this wrapper keeps the
                    corners looking right regardless of scrollbar width. */}
                <div className="overflow-hidden rounded-lg border border-input">
                  <Textarea
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={t("pastePlaceholder")}
                    // The shared Textarea defaults to `field-sizing: content`,
                    // which sizes the box to fit ALL its content — combined
                    // with a `max-h`, browsers still let the content spill
                    // past that cap instead of scrolling (the two properties
                    // don't compose reliably yet). `field-sizing-fixed`
                    // reverts to the classic model, where height is exactly
                    // what min/max-h say and overflow always scrolls inside
                    // it — the only combination guaranteed to keep pasted
                    // text inside the box.
                    className="field-sizing-fixed h-[260px] resize-none overflow-y-auto rounded-none border-0 font-mono text-xs"
                  />
                </div>
                <Button type="button" size="sm" onClick={handleSubmitPaste} disabled={submitting || !pastedText.trim()}>
                  {t("importSubmit")}
                </Button>
              </TabsContent>

              <TabsContent value="upload" className="space-y-3 pt-3">
                <Input
                  type="file"
                  accept=".csv,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="text-xs"
                />
                <p className="text-xs text-muted-foreground">{t("uploadHint")}</p>
                <Button type="button" size="sm" onClick={handleSubmitUpload} disabled={submitting || !file}>
                  {t("importSubmit")}
                </Button>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <a
                href="/api/prospecting/template"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                <Download className="h-3 w-3" />
                {t("downloadTemplate")}
              </a>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <a
          href="/api/prospecting/template"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
          {t("downloadTemplate")}
        </a>
      </div>
    </div>
  );
}
