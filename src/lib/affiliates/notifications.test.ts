import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendEmail = vi.fn(async () => undefined);
let configured = true;
vi.mock("@/lib/contracts/email", () => ({
  isEmailConfigured: () => configured,
  sendEmail: (...args: unknown[]) => (sendEmail as unknown as (...a: unknown[]) => Promise<void>)(...args),
}));

import { notifyAffiliate, notifyStore } from "./notifications";

/** Every chain method returns the same object; the terminal calls resolve per table. */
function fakeAdmin(tables: Record<string, unknown>) {
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const result = { data: tables[table] ?? null, error: null };
      for (const m of ["select", "eq", "in"]) chain[m] = () => chain;
      chain.maybeSingle = async () => result;
      chain.then = (resolve: (v: typeof result) => void) => resolve(result);
      return chain;
    },
  };
  return admin as unknown as SupabaseClient;
}

const req = new Request("http://internal/x", { headers: { "x-forwarded-host": "aureonag.com", "x-forwarded-proto": "https" } });
const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  sendEmail.mockClear();
  configured = true;
  process.env.NEXT_PUBLIC_SITE_URL = "";
});

describe("notifyAffiliate", () => {
  const tables = {
    aff_affiliates: { name: "Ana", email: "ana@exemplo.com", status: "active" },
    aff_clients: { name: "Loja Pink" },
  };

  it("tells the affiliate their invoice was rejected, with the reason and a link to the portal", async () => {
    notifyAffiliate(fakeAdmin(tables), req, {
      clientId: "c",
      affiliateId: "a",
      event: { kind: "invoice_rejected", period: "2026-09", reason: "CNPJ do tomador errado" },
    });
    await flush();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const mail = sendEmail.mock.calls[0] as unknown as [{ to: string; subject: string; text: string }];
    expect(mail[0].to).toBe("ana@exemplo.com");
    expect(mail[0].subject).toContain("Nota fiscal rejeitada");
    expect(mail[0].text).toContain("09/2026");
    expect(mail[0].text).toContain("CNPJ do tomador errado");
    expect(mail[0].text).toContain("https://aureonag.com/portal/afiliado/comissoes");
  });

  it("does nothing without SMTP and never throws", async () => {
    configured = false;
    expect(() =>
      notifyAffiliate(fakeAdmin(tables), req, { clientId: "c", affiliateId: "a", event: { kind: "invoice_approved", period: "2026-09" } }),
    ).not.toThrow();
    await flush();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips a disabled affiliate", async () => {
    notifyAffiliate(fakeAdmin({ ...tables, aff_affiliates: { name: "Ana", email: "ana@exemplo.com", status: "disabled" } }), req, {
      clientId: "c",
      affiliateId: "a",
      event: { kind: "invoice_approved", period: "2026-09" },
    });
    await flush();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("a failing SMTP is swallowed", async () => {
    sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    notifyAffiliate(fakeAdmin(tables), req, { clientId: "c", affiliateId: "a", event: { kind: "invoice_approved", period: "2026-09" } });
    await flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("notifyStore", () => {
  it("mails the store contact and its owner / finance people once each", async () => {
    notifyStore(
      fakeAdmin({
        aff_clients: { name: "Loja Pink", contact_email: "Dono@Pink.com" },
        aff_client_users: [{ email: "dono@pink.com" }, { email: "fin@pink.com" }],
      }),
      req,
      { clientId: "c", event: { kind: "invoice_submitted", affiliate: "Ana", period: "2026-09" } },
    );
    await flush();
    const to = sendEmail.mock.calls.map((c) => (c as unknown as [{ to: string }])[0].to).sort();
    expect(to).toEqual(["dono@pink.com", "fin@pink.com"]);
  });
});
