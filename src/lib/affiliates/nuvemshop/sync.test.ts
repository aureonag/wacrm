import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, nuvemshopRequest: (...args: unknown[]) => request(...args) };
});
vi.mock("./store", () => ({
  getIntegrationForClient: vi.fn(async () => ({ id: "int-1", client_id: "client-1", status: "connected", external_store_id: "999" })),
  getStoreAuth: vi.fn(async () => ({ externalStoreId: "999", token: "t" })),
}));

import { NuvemshopError } from "./api";
import { syncCampaignCoupons, syncClientCoupons, syncMembershipCoupon } from "./coupons";
import { importRecentOrders, ingestOrder } from "./orders-sync";
import type { Integration } from "./store";

type Row = Record<string, unknown>;

/** Just enough of the Supabase query builder for these modules, over in-memory tables. */
function fakeAdmin(tables: Record<string, Row[]>): SupabaseClient {
  function from(name: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "update" = "select";
    let patch: Row = {};
    let max = Infinity;
    const rows = () => (tables[name] ??= []);
    const run = () => {
      const hits = rows().filter((r) => filters.every((f) => f(r)));
      if (mode === "update") {
        for (const h of hits) Object.assign(h, patch);
        return { data: null, error: null };
      }
      return { data: hits.slice(0, max), error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
      limit: (n: number) => ((max = n), b),
      update: (p: Row) => ((mode = "update"), (patch = p), b),
      upsert: (row: Row, opts: { onConflict: string }) => {
        const keys = opts.onConflict.split(",");
        const hit = rows().find((r) => keys.every((k) => r[k] === row[k]));
        if (hit) Object.assign(hit, row);
        else rows().push({ ...row });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: () => {
        const r = run();
        return Promise.resolve({ data: (r.data as Row[] | null)?.[0] ?? null, error: null });
      },
      then: (resolve: (v: unknown) => unknown) => resolve(run()),
    };
    return b;
  }
  return { from } as unknown as SupabaseClient;
}

const integration: Integration = {
  id: "int-1",
  client_id: "client-1",
  external_store_id: "999",
  store_name: "Loja",
  store_url: null,
  scopes: null,
  status: "connected",
  last_error: null,
  webhooks_ok: true,
  installed_at: "2026-11-04T00:00:00Z",
};

const order = (over: Row = {}) => ({
  id: 5001,
  number: 105,
  status: "open",
  payment_status: "paid",
  subtotal: "200.00",
  discount: "20.00",
  total: "190.00",
  coupon: [{ code: "maria10" }],
  created_at: "2026-11-04T10:00:00Z",
  paid_at: "2026-11-04T10:05:00Z",
  ...over,
});

describe("ingestOrder", () => {
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      aff_orders: [],
      aff_memberships: [
        { id: "m-1", client_id: "client-1", affiliate_id: "a-1", code: "MARIA10", status: "approved" },
        { id: "m-2", client_id: "client-1", affiliate_id: "a-2", code: "PEDRO5", status: "inactive" },
        { id: "m-3", client_id: "client-OTHER", affiliate_id: "a-3", code: "OUTRO", status: "approved" },
      ],
    };
  });

  it("records a paid order that used an approved affiliate's coupon", async () => {
    const r = await ingestOrder(fakeAdmin(tables), integration, order());
    expect(r).toBe("stored");
    expect(tables.aff_orders).toHaveLength(1);
    expect(tables.aff_orders[0]).toMatchObject({
      client_id: "client-1",
      integration_id: "int-1",
      membership_id: "m-1",
      affiliate_id: "a-1",
      external_id: "5001",
      coupon_code: "MARIA10",
      total_cents: 18000,
      status: "paid",
    });
  });

  it("is idempotent: the same order twice stays one row, and follows the order's life", async () => {
    const admin = fakeAdmin(tables);
    await ingestOrder(admin, integration, order({ payment_status: "pending", paid_at: null }));
    expect(tables.aff_orders[0].status).toBe("pending");
    expect(await ingestOrder(admin, integration, order())).toBe("updated");
    expect(tables.aff_orders[0].status).toBe("paid");
    expect(await ingestOrder(admin, integration, order({ status: "cancelled" }))).toBe("updated");
    expect(tables.aff_orders).toHaveLength(1);
    expect(tables.aff_orders[0].status).toBe("cancelled");
  });

  it("keeps counting an already attributed order even if the participant was switched off later", async () => {
    const admin = fakeAdmin(tables);
    await ingestOrder(admin, integration, order());
    tables.aff_memberships[0].status = "inactive";
    expect(await ingestOrder(admin, integration, order({ payment_status: "refunded" }))).toBe("updated");
    expect(tables.aff_orders[0].status).toBe("cancelled");
  });

  it("ignores orders without a coupon, with a store coupon, or with a switched-off participant", async () => {
    const admin = fakeAdmin(tables);
    expect(await ingestOrder(admin, integration, order({ coupon: [] }))).toBe("ignored");
    expect(await ingestOrder(admin, integration, order({ id: 2, coupon: [{ code: "PROMO" }] }))).toBe("ignored");
    expect(await ingestOrder(admin, integration, order({ id: 3, coupon: [{ code: "PEDRO5" }] }))).toBe("ignored");
    expect(tables.aff_orders).toHaveLength(0);
  });

  it("never attributes a coupon of another client's participant", async () => {
    expect(await ingestOrder(fakeAdmin(tables), integration, order({ coupon: [{ code: "OUTRO" }] }))).toBe("ignored");
    expect(tables.aff_orders).toHaveLength(0);
  });

  it("ignores a store that is not linked to a client yet, and junk", async () => {
    const admin = fakeAdmin(tables);
    expect(await ingestOrder(admin, { ...integration, client_id: null }, order())).toBe("ignored");
    expect(await ingestOrder(admin, integration, { nope: true })).toBe("ignored");
    expect(tables.aff_orders).toHaveLength(0);
  });
});

describe("importRecentOrders", () => {
  const integ = { ...integration };

  beforeEach(() => request.mockReset());

  it("treats the store's '404 Last page is 0' (no orders at all) as an empty list", async () => {
    request.mockRejectedValueOnce(new NuvemshopError("Last page is 0", 404));
    await expect(importRecentOrders(integ, 30, fakeAdmin({ aff_orders: [], aff_memberships: [] }))).resolves.toEqual({ read: 0, stored: 0, updated: 0 });
  });

  it("records the orders of every page and stops when there is no next page", async () => {
    const tables = {
      aff_orders: [] as Row[],
      aff_memberships: [{ id: "m-1", client_id: "client-1", affiliate_id: "a-1", code: "MARIA10", status: "approved" }] as Row[],
    };
    request
      .mockResolvedValueOnce({ data: [order({ id: 1 }), order({ id: 2, coupon: [] })], next: "https://api.example/next" })
      .mockResolvedValueOnce({ data: [order({ id: 3 })], next: null });
    const r = await importRecentOrders(integ, 30, fakeAdmin(tables));
    expect(r).toEqual({ read: 3, stored: 2, updated: 0 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(tables.aff_orders.map((o) => o.external_id)).toEqual(["1", "3"]);
  });

  it("still fails on a real error", async () => {
    request.mockRejectedValueOnce(new NuvemshopError("boom", 500));
    await expect(importRecentOrders(integ, 30, fakeAdmin({}))).rejects.toThrow("boom");
  });
});

describe("coupon sync", () => {
  const newCampaign = (): Row => ({ status: "active", discount_type: "PERCENTAGE", discount: 10, start_date: "2026-11-01", end_date: null });
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    request.mockReset();
    tables = {
      aff_memberships: [
        { id: "m-1", client_id: "client-1", campaign_id: "c-1", code: "MARIA10", status: "approved", aff_campaigns: newCampaign() },
      ],
      aff_membership_coupons: [],
    };
  });

  it("creates the coupon in the store for an approved participant and remembers its id", async () => {
    request.mockResolvedValueOnce({ data: { id: 777 }, next: null });
    await syncMembershipCoupon("m-1", fakeAdmin(tables));
    expect(request).toHaveBeenCalledWith(expect.anything(), "POST", "/coupons", {
      code: "MARIA10",
      type: "percentage",
      value: "10.00",
      start_date: "2026-11-01",
    });
    expect(tables.aff_membership_coupons[0]).toMatchObject({ membership_id: "m-1", integration_id: "int-1", external_coupon_id: "777", state: "synced" });
  });

  it("updates an existing coupon instead of creating a second one", async () => {
    tables.aff_membership_coupons.push({ membership_id: "m-1", integration_id: "int-1", external_coupon_id: "777", state: "synced" });
    (tables.aff_memberships[0].aff_campaigns as Row).discount = 15;
    request.mockResolvedValueOnce({ data: {}, next: null });
    await syncCampaignCoupons("client-1", "c-1", fakeAdmin(tables));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.anything(), "PUT", "/coupons/777", expect.objectContaining({ value: "15.00" }));
  });

  it("creates it again when it was deleted in the store", async () => {
    tables.aff_membership_coupons.push({ membership_id: "m-1", integration_id: "int-1", external_coupon_id: "777", state: "synced" });
    request.mockRejectedValueOnce(new NuvemshopError("not found", 404)).mockResolvedValueOnce({ data: { id: 888 }, next: null });
    await syncMembershipCoupon("m-1", fakeAdmin(tables));
    expect(tables.aff_membership_coupons[0]).toMatchObject({ external_coupon_id: "888", state: "synced" });
  });

  it("removes the coupon when the participant is switched off or the campaign deactivated", async () => {
    tables.aff_membership_coupons.push({ membership_id: "m-1", integration_id: "int-1", external_coupon_id: "777", state: "synced" });
    tables.aff_memberships[0].status = "inactive";
    request.mockResolvedValueOnce({ data: {}, next: null });
    await syncMembershipCoupon("m-1", fakeAdmin(tables));
    expect(request).toHaveBeenCalledWith(expect.anything(), "DELETE", "/coupons/777");
    expect(tables.aff_membership_coupons[0]).toMatchObject({ external_coupon_id: null, state: "removed" });

    request.mockClear();
    tables.aff_memberships[0].status = "approved";
    (tables.aff_memberships[0].aff_campaigns as Row).status = "inactive";
    await syncMembershipCoupon("m-1", fakeAdmin(tables));
    expect(request).not.toHaveBeenCalled(); // already removed, nothing to do
  });

  it("does nothing for a participant who never had a coupon and should not have one", async () => {
    tables.aff_memberships[0].status = "pending";
    await syncMembershipCoupon("m-1", fakeAdmin(tables));
    expect(request).not.toHaveBeenCalled();
    expect(tables.aff_membership_coupons).toHaveLength(0);
  });

  it("records why a coupon failed (code already exists) and does not throw", async () => {
    request.mockRejectedValueOnce(new NuvemshopError("code has already been taken", 422));
    await expect(syncMembershipCoupon("m-1", fakeAdmin(tables))).resolves.toBeUndefined();
    expect(tables.aff_membership_coupons[0].state).toBe("error");
    expect(String(tables.aff_membership_coupons[0].last_error)).toContain("já existe");
  });

  it("syncs the whole client and reports what happened", async () => {
    tables.aff_memberships.push({ id: "m-2", client_id: "client-1", campaign_id: "c-1", code: "JOAO", status: "pending", aff_campaigns: newCampaign() });
    request.mockResolvedValueOnce({ data: { id: 1 }, next: null });
    const summary = await syncClientCoupons("client-1", fakeAdmin(tables));
    expect(summary).toEqual({ created: 1, updated: 0, removed: 0, unchanged: 1, error: 0 });
  });
});
