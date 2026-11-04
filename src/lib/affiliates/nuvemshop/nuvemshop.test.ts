import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCouponPayload, couponShouldExist } from "./coupon-payload";
import { couponCodesOf, mapOrderStatus, parseOrder } from "./orders";
import {
  safeReturnPath,
  signInstallState,
  verifyInstallState,
  verifyWebhookSignature,
  withResult,
} from "./security";

describe("verifyWebhookSignature", () => {
  const secret = "app-secret";
  const body = '{"store_id":123,"event":"order/paid","id":9}';
  const good = createHmac("sha256", secret).update(body).digest("hex");

  it("accepts the HMAC of the exact raw body", () => {
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
    expect(verifyWebhookSignature(body, good.toUpperCase(), secret)).toBe(true);
  });

  it("rejects a changed body, a wrong secret, and a missing header", () => {
    expect(verifyWebhookSignature(body + " ", good, secret)).toBe(false);
    expect(verifyWebhookSignature(body, good, "other")).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "abc", secret)).toBe(false);
  });

  it("never accepts anything when the secret is not configured", () => {
    const emptyKey = createHmac("sha256", "").update(body).digest("hex");
    expect(verifyWebhookSignature(body, emptyKey, "")).toBe(false);
  });
});

describe("install state", () => {
  const secret = "s3cret";
  const input = { clientId: "11111111-1111-1111-1111-111111111111", returnTo: "/operational/afiliados/clientes/x/integracoes" };

  it("round-trips while valid", () => {
    const token = signInstallState(input, secret, 1_000);
    const state = verifyInstallState(token, secret, 2_000);
    expect(state?.c).toBe(input.clientId);
    expect(state?.r).toBe(input.returnTo);
  });

  it("expires", () => {
    const token = signInstallState(input, secret, 1_000);
    expect(verifyInstallState(token, secret, 1_000 + 16 * 60 * 1000)).toBeNull();
  });

  it("rejects a tampered payload, another secret, and junk", () => {
    const token = signInstallState(input, secret, 1_000);
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ c: "other", r: "/x", n: "1", e: 9e15 })).toString("base64url");
    expect(verifyInstallState(`${forged}.${sig}`, secret, 2_000)).toBeNull();
    expect(verifyInstallState(token, "other", 2_000)).toBeNull();
    expect(verifyInstallState(`${payload}.${sig}.extra`, secret, 2_000)).toBeNull();
    expect(verifyInstallState(null, secret)).toBeNull();
    expect(verifyInstallState("nonsense", secret)).toBeNull();
  });
});

describe("return paths", () => {
  const fallback = "/operational/afiliados";
  it("only lets the Afiliados workspace through", () => {
    expect(safeReturnPath("/operational/afiliados/clientes/1/integracoes", fallback)).toBe("/operational/afiliados/clientes/1/integracoes");
    expect(safeReturnPath("/portal/loja/1/integracoes", fallback)).toBe("/portal/loja/1/integracoes");
    for (const bad of ["//evil.com", "https://evil.com", "/dashboard", "/operational/afiliados/..\\x", "/portal/loja/1\r\nX: y", null, ""]) {
      expect(safeReturnPath(bad as string | null, fallback)).toBe(fallback);
    }
  });

  it("sets the result without duplicating it", () => {
    expect(withResult("/portal/loja/1/integracoes?a=1", "connected")).toBe("/portal/loja/1/integracoes?a=1&nuvemshop=connected");
    expect(withResult("/p?nuvemshop=error", "connected")).toBe("/p?nuvemshop=connected");
  });
});

describe("order status", () => {
  it("maps payment and order status", () => {
    expect(mapOrderStatus("open", "paid")).toBe("paid");
    expect(mapOrderStatus("closed", "paid")).toBe("paid");
    expect(mapOrderStatus("open", "pending")).toBe("pending");
    expect(mapOrderStatus("open", "authorized")).toBe("pending");
    expect(mapOrderStatus("cancelled", "paid")).toBe("cancelled");
    expect(mapOrderStatus("open", "voided")).toBe("cancelled");
    expect(mapOrderStatus("open", "refunded")).toBe("cancelled");
    expect(mapOrderStatus("open", "abandoned")).toBe("cancelled");
    expect(mapOrderStatus("open", "partially_refunded")).toBe("paid");
  });
});

describe("parseOrder", () => {
  it("values the order as products after discounts, shipping excluded", () => {
    const o = parseOrder({
      id: 871254203,
      number: 105,
      status: "open",
      payment_status: "paid",
      subtotal: "6000.00",
      discount: "600.00",
      total: "5550.00", // includes R$150 shipping
      coupon: [{ code: "maria10", type: "percentage", value: "10.00" }],
      created_at: "2026-11-04T19:36:59+0000",
      paid_at: "2026-11-04T19:40:00+0000",
    });
    expect(o).toMatchObject({
      externalId: "871254203",
      number: "105",
      status: "paid",
      totalCents: 540000,
      couponCodes: ["MARIA10"],
      orderedAt: "2026-11-04T19:36:59.000Z",
      paidAt: "2026-11-04T19:40:00.000Z",
    });
  });

  it("falls back to the total without a subtotal and never goes negative", () => {
    expect(parseOrder({ id: 1, total: "10.50" })?.totalCents).toBe(1050);
    expect(parseOrder({ id: 1, subtotal: "10.00", discount: "30.00" })?.totalCents).toBe(0);
  });

  it("rejects what is not an order", () => {
    expect(parseOrder(null)).toBeNull();
    expect(parseOrder({})).toBeNull();
    expect(parseOrder("x")).toBeNull();
  });

  it("reads coupons given as codes, objects, or not at all", () => {
    expect(couponCodesOf(["abc", { code: "def" }, { nope: 1 }, "", null])).toEqual(["ABC", "DEF"]);
    expect(couponCodesOf(undefined)).toEqual([]);
    expect(couponCodesOf([])).toEqual([]);
  });
});

describe("coupon payload", () => {
  const base = { status: "active" as const, discount_type: "PERCENTAGE" as const, discount: 10, start_date: "2026-11-01", end_date: null };

  it("builds a percentage coupon without an end date for recurrent campaigns", () => {
    expect(buildCouponPayload("maria10", base)).toEqual({ code: "MARIA10", type: "percentage", value: "10.00", start_date: "2026-11-01" });
  });

  it("builds an absolute coupon with the end date for periodic campaigns", () => {
    expect(buildCouponPayload("JOAO", { ...base, discount_type: "CURRENCY", discount: "25.5", end_date: "2026-12-31" })).toEqual({
      code: "JOAO",
      type: "absolute",
      value: "25.50",
      start_date: "2026-11-01",
      end_date: "2026-12-31",
    });
  });

  it("exists only for approved participants of an active campaign", () => {
    expect(couponShouldExist("approved", "active")).toBe(true);
    expect(couponShouldExist("approved", "inactive")).toBe(false);
    expect(couponShouldExist("pending", "active")).toBe(false);
    expect(couponShouldExist("inactive", "active")).toBe(false);
    expect(couponShouldExist("rejected", "active")).toBe(false);
  });
});
