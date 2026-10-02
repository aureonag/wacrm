"use client";

import { useParams } from "next/navigation";
import { CommissionsView } from "@/app/operational/afiliados/_components/commissions-view";

export default function AffiliatePaymentsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  return <CommissionsView clientId={clientId} mode="payments" />;
}
