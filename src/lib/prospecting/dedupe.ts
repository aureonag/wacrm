// ============================================================
// Prospecting: candidate deduplication against the CRM's existing
// contacts/deals.
//
// Checked in order (first match wins, matching the client's spec):
//   1. Google Place ID (against previously-imported candidates)
//   2. Normalized website domain
//   3. Normalized phone (reuses `findExistingContact` — the same
//      dedup key `deal-create-modal.tsx` already uses)
//   4. Normalized Instagram handle
//   5. Normalized email
//   6. Normalized company name + city (lowest confidence — flagged as
//      "possible_duplicate", never auto-classified as "existing")
//
// The normalization helpers are pure and exported separately so they
// can be unit-tested without a database.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { findExistingContact } from "@/lib/contacts/dedupe";

export type DuplicateStatus = "new" | "possible_duplicate" | "existing";

export interface DuplicateCheckInput {
  googlePlaceId?: string | null;
  website?: string | null;
  phone?: string | null;
  instagram?: string | null;
  email?: string | null;
  companyName: string;
  city?: string | null;
}

export interface DuplicateCheckResult {
  status: DuplicateStatus;
  contactId: string | null;
  dealId: string | null;
  matchedOn:
    | "google_place_id"
    | "domain"
    | "phone"
    | "instagram"
    | "email"
    | "name_city"
    | null;
}

const NO_MATCH: DuplicateCheckResult = {
  status: "new",
  contactId: null,
  dealId: null,
  matchedOn: null,
};

/** "https://www.Example.com/path/" -> "example.com" */
export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

/** "@Example_Co", "https://instagram.com/example_co/" -> "example_co" */
export function normalizeInstagramHandle(handle: string | null | undefined): string | null {
  if (!handle) return null;
  let value = handle.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  value = value.replace(/^@/, "");
  value = value.replace(/\/.*$/, "");
  return value || null;
}

/** Lowercases, strips accents/punctuation and common legal suffixes for a loose name match. */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const stripped = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/[.,\-–—]/g, " ")
    .replace(
      /\b(ltda|me|eireli|sa|s\/a|inc|llc|corp|company|comercio|comercial|servicos|servico)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return stripped || null;
}

export async function checkDuplicate(
  db: SupabaseClient,
  accountId: string,
  input: DuplicateCheckInput,
): Promise<DuplicateCheckResult> {
  // 1. Google Place ID — only a place that was actually imported before
  // (has a real contact/deal attached) counts as "existing"; a bare
  // candidate row from an earlier, un-imported run doesn't.
  if (input.googlePlaceId) {
    const { data } = await db
      .from("prospecting_candidates")
      .select("imported_contact_id, imported_deal_id")
      .eq("account_id", accountId)
      .eq("google_place_id", input.googlePlaceId)
      .not("imported_deal_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (data) {
      return {
        status: "existing",
        contactId: (data.imported_contact_id as string | null) ?? null,
        dealId: (data.imported_deal_id as string | null) ?? null,
        matchedOn: "google_place_id",
      };
    }
  }

  // 2. Normalized website domain.
  const domain = normalizeDomain(input.website);
  if (domain) {
    const { data } = await db
      .from("contacts")
      .select("id, website")
      .eq("account_id", accountId)
      .not("website", "is", null);
    const match = (data ?? []).find(
      (c) => normalizeDomain(c.website as string) === domain,
    );
    if (match) {
      return { status: "existing", contactId: match.id as string, dealId: null, matchedOn: "domain" };
    }
  }

  // 3. Normalized phone — the same key the rest of the CRM already
  // dedups contacts on.
  if (input.phone) {
    const existing = await findExistingContact(db, accountId, input.phone);
    if (existing) {
      return { status: "existing", contactId: existing.id, dealId: null, matchedOn: "phone" };
    }
  }

  // 4. Normalized Instagram handle.
  const instagram = normalizeInstagramHandle(input.instagram);
  if (instagram) {
    const { data } = await db
      .from("contacts")
      .select("id, instagram")
      .eq("account_id", accountId)
      .not("instagram", "is", null);
    const match = (data ?? []).find(
      (c) => normalizeInstagramHandle(c.instagram as string) === instagram,
    );
    if (match) {
      return { status: "existing", contactId: match.id as string, dealId: null, matchedOn: "instagram" };
    }
  }

  // 5. Normalized email.
  const email = input.email?.trim().toLowerCase() || null;
  if (email) {
    const { data } = await db
      .from("contacts")
      .select("id")
      .eq("account_id", accountId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (data) {
      return { status: "existing", contactId: data.id as string, dealId: null, matchedOn: "email" };
    }
  }

  // 6. Normalized name + city — lowest confidence, always surfaced as
  // "possible_duplicate" (never auto-classified as a confirmed match)
  // so a human reviews it before anything gets skipped or merged.
  const normalizedName = normalizeCompanyName(input.companyName);
  if (normalizedName) {
    const { data } = await db
      .from("contacts")
      .select("id, name")
      .eq("account_id", accountId)
      .not("name", "is", null);
    const match = (data ?? []).find((c) => normalizeCompanyName(c.name as string) === normalizedName);
    if (match) {
      return {
        status: "possible_duplicate",
        contactId: match.id as string,
        dealId: null,
        matchedOn: "name_city",
      };
    }
  }

  return NO_MATCH;
}
