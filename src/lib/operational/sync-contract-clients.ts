// Every signed, not-cancelled contract is a client of the operation: this
// makes sure each one has an `ops_clients` row (Operacional → Clientes).
// Idempotent and additive — it only creates clients / fills `contract_id`,
// never edits a name, never deletes, never touches a client already linked.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractCodeFromTitle } from "./clients-projects";

/** "00351 - CG Complemento" / "Kickoff - 00351 - CG Complemento" -> "CG Complemento". */
export function clientNameFromTitle(title: string | null | undefined): string | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  const m = /^\s*(?:kickoff\s*-\s*)?\d{3,6}\s*-\s*(.+)$/i.exec(t);
  return (m ? m[1] : t).trim() || null;
}

/** Name comparison key: no accents, case, spaces or punctuation ("Pink Heels" = "PinkHeels"). */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

interface ExistingClient {
  id: string;
  name: string;
  code: string | null;
  contract_id: string | null;
}

/** An unlinked client that is the same company as the contract: same name, or same code + one name inside the other. */
export function findMatchingClient(
  clients: ExistingClient[],
  name: string,
  code: string | null,
): ExistingClient | null {
  const key = nameKey(name);
  if (!key) return null;
  const same = clients.find((c) => nameKey(c.name) === key);
  if (same) return same;
  if (!code) return null;
  return (
    clients.find((c) => {
      if (c.code !== code) return false;
      const other = nameKey(c.name);
      return other.length >= 3 && (other.includes(key) || key.includes(other));
    }) ?? null
  );
}

export interface SyncResult {
  created: number;
  linked: number;
}

export async function syncSignedContractClients(
  admin: SupabaseClient,
  accountId: string,
  onlyContractId?: string,
): Promise<SyncResult> {
  const result: SyncResult = { created: 0, linked: 0 };

  let q = admin
    .from("deal_contracts")
    .select("id, razao_social, signed_at, deal:deals(contact_id, title)")
    .eq("account_id", accountId)
    .eq("status", "signed")
    .is("terminated_at", null)
    .order("signed_at", { ascending: true });
  if (onlyContractId) q = q.eq("id", onlyContractId);
  const [contracts, existing] = await Promise.all([
    q,
    admin.from("ops_clients").select("id, name, code, contract_id").eq("account_id", accountId),
  ]);
  if (contracts.error || existing.error) {
    console.error("[sync-contract-clients] load failed:", contracts.error?.message ?? existing.error?.message);
    return result;
  }

  const clients: ExistingClient[] = (existing.data ?? []) as ExistingClient[];
  const linkedContracts = new Set(clients.map((c) => c.contract_id).filter((x): x is string => Boolean(x)));

  for (const c of contracts.data ?? []) {
    const contractId = c.id as string;
    if (linkedContracts.has(contractId)) continue;

    const deal = (Array.isArray(c.deal) ? c.deal[0] : c.deal) as { contact_id: string | null; title: string | null } | null;
    const code = extractCodeFromTitle(deal?.title) ?? extractCodeFromTitle(c.razao_social as string | null);
    const name = clientNameFromTitle(deal?.title) ?? (c.razao_social as string | null)?.trim();
    if (!name) continue;

    const match = findMatchingClient(clients, name, code);
    if (match) {
      // Already a client (e.g. imported from Runrun). Link it to the first
      // contract only; a second contract of the same client is just another scope.
      if (match.contract_id) continue;
      const patch: Record<string, unknown> = { contract_id: contractId };
      if (deal?.contact_id) patch.contact_id = deal.contact_id;
      if (!match.code && code) patch.code = code;
      const { error } = await admin.from("ops_clients").update(patch).eq("id", match.id).eq("account_id", accountId);
      if (error) {
        console.error("[sync-contract-clients] link failed:", error.message);
        continue;
      }
      match.contract_id = contractId;
      if (!match.code && code) match.code = code;
      linkedContracts.add(contractId);
      result.linked += 1;
      continue;
    }

    const { data, error } = await admin
      .from("ops_clients")
      .insert({
        account_id: accountId,
        name,
        code,
        status: "active",
        contract_id: contractId,
        contact_id: deal?.contact_id ?? null,
      })
      .select("id, name, code, contract_id")
      .single();
    if (error) {
      // 23505: the same name already exists (raced with another request) — fine.
      if (error.code !== "23505") console.error("[sync-contract-clients] insert failed:", error.message);
      continue;
    }
    clients.push(data as ExistingClient);
    linkedContracts.add(contractId);
    result.created += 1;
  }
  return result;
}
