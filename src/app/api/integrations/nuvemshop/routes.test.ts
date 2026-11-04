import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterCallbacks: (() => unknown)[] = [];
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (fn: () => unknown) => void afterCallbacks.push(fn) };
});
const handleWebhookEvent = vi.fn(async (_payload: unknown) => undefined);
const redactStore = vi.fn(async (_storeId: string) => undefined);
vi.mock("@/lib/affiliates/nuvemshop/webhooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/affiliates/nuvemshop/webhooks")>();
  return { ...actual, handleWebhookEvent: (p: unknown) => handleWebhookEvent(p), redactStore: (s: string) => redactStore(s) };
});
const completeInstall = vi.fn();
vi.mock("@/lib/affiliates/nuvemshop/install", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/affiliates/nuvemshop/install")>();
  return { ...actual, completeInstall: (a: unknown) => completeInstall(a) };
});

import { signInstallState } from "@/lib/affiliates/nuvemshop/security";
import { GET as callback } from "./callback/route";
import { POST as events } from "./webhooks/events/route";
import { POST as storeRedact } from "./webhooks/store-redact/route";
import { POST as customersRedact } from "./webhooks/customers-redact/route";
import { POST as customersDataRequest } from "./webhooks/customers-data-request/route";

const SECRET = "test-app-secret";
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
const hook = (body: string, signature?: string) =>
  new Request("https://aureonag.com/hook", {
    method: "POST",
    body,
    headers: signature === undefined ? {} : { "x-linkedstore-hmac-sha256": signature },
  });

beforeEach(() => {
  afterCallbacks.length = 0;
  process.env.NUVEMSHOP_APP_ID = "50395";
  process.env.NUVEMSHOP_APP_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = "https://aureonag.com";
});
afterEach(() => {
  delete process.env.NUVEMSHOP_APP_ID;
  delete process.env.NUVEMSHOP_APP_SECRET;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("webhook routes", () => {
  const body = JSON.stringify({ store_id: 123, event: "order/paid", id: 9 });

  it("accepts a correctly signed event and handles it after answering", async () => {
    const res = await events(hook(body, sign(body)));
    expect(res.status).toBe(200);
    expect(handleWebhookEvent).not.toHaveBeenCalled(); // not before the answer
    await afterCallbacks[0]();
    expect(handleWebhookEvent).toHaveBeenCalledWith({ store_id: 123, event: "order/paid", id: 9 });
  });

  it("refuses a missing, wrong or body-mismatched signature and does no work", async () => {
    for (const sig of [undefined, "", "deadbeef", sign(body + " ")]) {
      const res = await events(hook(body, sig));
      expect(res.status).toBe(401);
    }
    expect(afterCallbacks).toHaveLength(0);
  });

  it("refuses everything while the app secret is not configured", async () => {
    delete process.env.NUVEMSHOP_APP_SECRET;
    const res = await events(hook(body, sign(body)));
    expect(res.status).toBe(503);
  });

  it("rejects a signed body that is not a webhook payload", async () => {
    const junk = "not json";
    expect((await events(hook(junk, sign(junk)))).status).toBe(400);
  });

  it("store/redact deletes the store's connection after answering", async () => {
    const b = JSON.stringify({ store_id: 321, event: "store/redact" });
    const res = await storeRedact(hook(b, sign(b)));
    expect(res.status).toBe(200);
    await afterCallbacks[0]();
    expect(redactStore).toHaveBeenCalledWith("321");
  });

  it("customer LGPD webhooks are acknowledged only when signed", async () => {
    const b = JSON.stringify({ store_id: 1, event: "customers/redact", customer: { id: 5 } });
    expect((await customersRedact(hook(b, sign(b)))).status).toBe(200);
    expect((await customersDataRequest(hook(b, sign(b)))).status).toBe(200);
    expect((await customersRedact(hook(b, "bad"))).status).toBe(401);
    expect((await customersDataRequest(hook(b))).status).toBe(401);
  });
});

describe("OAuth callback", () => {
  const get = (qs: string) => callback(new Request(`https://aureonag.com/api/integrations/nuvemshop/callback?${qs}`));
  const where = (res: Response) => res.headers.get("location");

  beforeEach(() => completeInstall.mockReset());

  it("sends a merchant who installed from the Nuvemshop to the thank-you page (unlinked)", async () => {
    completeInstall.mockResolvedValue({ ok: true, integration: { id: "i", client_id: null } });
    const res = await get("code=abc");
    expect(completeInstall).toHaveBeenCalledWith({ code: "abc", clientId: null, origin: "https://aureonag.com" });
    expect(where(res)).toBe("https://aureonag.com/integracoes/nuvemshop/instalado?status=installed");
  });

  it("links the store to the client named in a valid signed state and returns to the page", async () => {
    completeInstall.mockResolvedValue({ ok: true, integration: { id: "i", client_id: "c-1" } });
    const state = signInstallState({ clientId: "c-1", returnTo: "/portal/loja/c-1/integracoes" }, SECRET);
    const res = await get(`code=abc&state=${encodeURIComponent(state)}`);
    expect(completeInstall).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c-1" }));
    expect(where(res)).toBe("https://aureonag.com/portal/loja/c-1/integracoes?nuvemshop=connected");
  });

  it("refuses a forged or expired state without exchanging the code", async () => {
    const forged = signInstallState({ clientId: "c-1", returnTo: "/portal/loja/c-1/integracoes" }, "another-secret");
    const expired = signInstallState({ clientId: "c-1", returnTo: "/portal/loja/c-1/integracoes" }, SECRET, Date.now() - 60 * 60 * 1000);
    for (const state of [forged, expired, "garbage"]) {
      const res = await get(`code=abc&state=${encodeURIComponent(state)}`);
      expect(where(res)).toBe("https://aureonag.com/integracoes/nuvemshop/instalado?status=error");
    }
    expect(completeInstall).not.toHaveBeenCalled();
  });

  it("never redirects outside the Afiliados pages, even with a signed state", async () => {
    completeInstall.mockResolvedValue({ ok: true, integration: { id: "i", client_id: "c-1" } });
    const state = signInstallState({ clientId: "c-1", returnTo: "https://evil.example/steal" }, SECRET);
    const res = await get(`code=abc&state=${encodeURIComponent(state)}`);
    expect(where(res)).toBe("https://aureonag.com/operational/afiliados/clientes?nuvemshop=connected");
  });

  it("reports a denied authorization, a missing code, and a client that already has another store", async () => {
    expect(where(await get("error=access_denied"))).toContain("status=denied");
    expect(where(await get(""))).toContain("status=error");
    completeInstall.mockResolvedValue({ ok: false, reason: "client_has_other_store" });
    expect(where(await get("code=abc"))).toContain("status=other_store");
  });

  it("says so when the app is not configured, without touching the code", async () => {
    delete process.env.NUVEMSHOP_APP_SECRET;
    expect(where(await get("code=abc"))).toContain("status=not_configured");
    expect(completeInstall).not.toHaveBeenCalled();
  });
});
