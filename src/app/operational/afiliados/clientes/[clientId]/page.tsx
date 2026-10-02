import { redirect } from "next/navigation";

export default async function AffiliateClientIndex({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  redirect(`/operational/afiliados/clientes/${clientId}/campanhas`);
}
