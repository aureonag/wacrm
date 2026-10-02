"use client";

import { useParams } from "next/navigation";
import { CampaignEditor } from "@/app/operational/afiliados/_components/campaign-editor";

export default function NewAffiliateCampaignPage() {
  const { clientId } = useParams<{ clientId: string }>();
  return <CampaignEditor clientId={clientId} campaign={null} />;
}
