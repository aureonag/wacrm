import { redirect } from "next/navigation";

export default async function StoreIndex({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  redirect(`/portal/loja/${clientId}/dashboard`);
}
