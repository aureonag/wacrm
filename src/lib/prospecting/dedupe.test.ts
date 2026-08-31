import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExistingContact: vi.fn(),
}));

vi.mock("@/lib/contacts/dedupe", () => ({
  findExistingContact: mocks.findExistingContact,
}));

import {
  checkDuplicate,
  normalizeCompanyName,
  normalizeDomain,
  normalizeInstagramHandle,
} from "./dedupe";

describe("normalizeDomain", () => {
  it("strips protocol, www, and path", () => {
    expect(normalizeDomain("https://www.Example.com/some/path")).toBe("example.com");
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("http://EXAMPLE.com/")).toBe("example.com");
  });

  it("returns null for empty/invalid input", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });
});

describe("normalizeInstagramHandle", () => {
  it("strips @, full URL, and trailing slash", () => {
    expect(normalizeInstagramHandle("@Example_Co")).toBe("example_co");
    expect(normalizeInstagramHandle("https://instagram.com/example_co/")).toBe("example_co");
    expect(normalizeInstagramHandle("instagram.com/example_co")).not.toBe("example_co"); // no protocol -> not stripped, documents current limitation
  });

  it("returns null for empty input", () => {
    expect(normalizeInstagramHandle(null)).toBeNull();
    expect(normalizeInstagramHandle("")).toBeNull();
  });
});

describe("normalizeCompanyName", () => {
  it("lowercases and strips common legal suffixes", () => {
    expect(normalizeCompanyName("Acme Serviços Ltda")).toBe("acme");
    expect(normalizeCompanyName("ACME COMERCIAL S/A")).toBe("acme");
  });

  it("returns null for empty input", () => {
    expect(normalizeCompanyName(null)).toBeNull();
    expect(normalizeCompanyName("")).toBeNull();
  });
});

function fakeSupabase(responses: Record<string, unknown>) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    calls.push(table);
    const response = responses[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    builder.select = vi.fn(chain);
    builder.eq = vi.fn(chain);
    builder.not = vi.fn(chain);
    builder.ilike = vi.fn(chain);
    builder.limit = vi.fn(chain);
    builder.maybeSingle = vi.fn().mockResolvedValue(response);
    // For queries that don't call maybeSingle (list-style .not() chains),
    // resolve the builder itself when awaited.
    builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(response));
    return builder;
  });
  return { db: { from } as never, calls };
}

beforeEach(() => {
  mocks.findExistingContact.mockReset();
});

describe("checkDuplicate", () => {
  it("matches on Google Place ID and short-circuits before any phone lookup runs", async () => {
    const { db, calls } = fakeSupabase({
      prospecting_candidates: {
        data: { imported_contact_id: "contact-1", imported_deal_id: "deal-1" },
        error: null,
      },
    });

    const result = await checkDuplicate(db, "acct-1", {
      googlePlaceId: "place-123",
      phone: "+5511999999999",
      companyName: "Acme",
    });

    expect(result).toEqual({
      status: "existing",
      contactId: "contact-1",
      dealId: "deal-1",
      matchedOn: "google_place_id",
    });
    expect(calls).toEqual(["prospecting_candidates"]);
    expect(mocks.findExistingContact).not.toHaveBeenCalled();
  });

  it("falls through to phone matching when there is no Place ID match, delegating to findExistingContact", async () => {
    const { db } = fakeSupabase({
      prospecting_candidates: { data: null, error: null },
    });
    mocks.findExistingContact.mockResolvedValue({ id: "contact-2", phone: "+5511988887777" });

    const result = await checkDuplicate(db, "acct-1", {
      googlePlaceId: "place-999",
      phone: "+5511988887777",
      companyName: "Acme",
    });

    expect(result.status).toBe("existing");
    expect(result.matchedOn).toBe("phone");
    expect(result.contactId).toBe("contact-2");
    expect(mocks.findExistingContact).toHaveBeenCalledWith(db, "acct-1", "+5511988887777");
  });

  it("only reaches the name+city fallback when every stronger key is absent, and marks it possible_duplicate (never existing)", async () => {
    const { db } = fakeSupabase({
      contacts: { data: [{ id: "contact-3", name: "Acme Ltda" }], error: null },
    });

    const result = await checkDuplicate(db, "acct-1", {
      companyName: "ACME S/A",
    });

    expect(mocks.findExistingContact).not.toHaveBeenCalled();
    expect(result.status).toBe("possible_duplicate");
    expect(result.matchedOn).toBe("name_city");
    expect(result.contactId).toBe("contact-3");
  });

  it("returns 'new' when nothing matches at any tier", async () => {
    const { db } = fakeSupabase({});
    const result = await checkDuplicate(db, "acct-1", { companyName: "Totally New Co" });
    expect(result).toEqual({ status: "new", contactId: null, dealId: null, matchedOn: null });
  });
});
