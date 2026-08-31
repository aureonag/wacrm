"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ProspectingChat } from "@/components/prospecting/prospecting-chat";
import {
  ProspectingConfigCard,
  type ProspectingSelections,
} from "@/components/prospecting/prospecting-config-card";
import { PROSPECTING_DEFAULT_QUANTITY } from "@/lib/prospecting/constants";

export default function ProspectingPage() {
  const t = useTranslations("Prospecting");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selections, setSelections] = useState<ProspectingSelections>({
    pipelineId: "",
    ownerId: "",
    frenteLeadgen: false,
    frenteAvr: false,
    quantity: PROSPECTING_DEFAULT_QUANTITY,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <ProspectingChat
          conversationId={conversationId}
          onConversationCreated={setConversationId}
          selections={selections}
        />

        <div className="rounded-xl border border-border bg-card p-4">
          <ProspectingConfigCard selections={selections} onChange={setSelections} />
        </div>
      </div>
    </div>
  );
}
