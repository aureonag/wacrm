import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDeliverableUrl: vi.fn(),
}));

vi.mock("@/lib/webhooks/ssrf", () => ({ isDeliverableUrl: mocks.isDeliverableUrl }));

import { analyzeWebsite } from "./website-analyzer";

const originalFetch = global.fetch;

beforeEach(() => {
  mocks.isDeliverableUrl.mockReset();
  mocks.isDeliverableUrl.mockResolvedValue(true);
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function htmlResponse(html: string, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html" } });
}

describe("analyzeWebsite", () => {
  it("never fetches a URL that fails the SSRF check", async () => {
    mocks.isDeliverableUrl.mockResolvedValue(false);
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;

    const result = await analyzeWebsite("http://169.254.169.254/");

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) protocol before ever checking deliverability", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;

    const result = await analyzeWebsite("file:///etc/passwd");

    expect(result).toBeNull();
    expect(mocks.isDeliverableUrl).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("extracts title, description, phone, email, social links, CTA, and responsive signals", async () => {
    const html = `<!doctype html><html><head>
      <title>Clínica Exemplo</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="description" content="A melhor clínica da região">
      </head><body>
      <a href="https://instagram.com/clinicaexemplo">Instagram</a>
      <a href="https://wa.me/5511999998888">Fale conosco no WhatsApp</a>
      Contato: contato@clinicaexemplo.com.br ou (11) 99999-8888
      </body></html>`;
    global.fetch = vi.fn().mockResolvedValue(htmlResponse(html)) as never;

    const result = await analyzeWebsite("https://clinicaexemplo.com.br");

    expect(result).toMatchObject({
      finalUrl: "https://clinicaexemplo.com.br",
      hasHttps: true,
      title: "Clínica Exemplo",
      description: "A melhor clínica da região",
      email: "contato@clinicaexemplo.com.br",
      looksResponsive: true,
      hasCallToActionSignal: true,
    });
    expect(result?.socialLinks).toEqual(
      expect.arrayContaining(["https://instagram.com/clinicaexemplo", "https://wa.me/5511999998888"]),
    );
    expect(result?.phone).toBeTruthy();
  });

  it("follows a redirect, re-validating SSRF on the new URL", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.clinicaexemplo.com.br/" } }))
      .mockResolvedValueOnce(htmlResponse("<title>Home</title>"));
    global.fetch = fetchSpy as never;

    const result = await analyzeWebsite("https://clinicaexemplo.com.br");

    expect(result?.finalUrl).toBe("https://www.clinicaexemplo.com.br/");
    expect(mocks.isDeliverableUrl).toHaveBeenCalledWith("https://clinicaexemplo.com.br");
    expect(mocks.isDeliverableUrl).toHaveBeenCalledWith("https://www.clinicaexemplo.com.br/");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refuses to follow a redirect into a non-deliverable address", async () => {
    mocks.isDeliverableUrl.mockImplementation(async (u: string) => !u.includes("169.254"));
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/secret" } }));
    global.fetch = fetchSpy as never;

    const result = await analyzeWebsite("https://clinicaexemplo.com.br");

    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives up after too many redirects instead of looping forever", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 301, headers: { location: "https://clinicaexemplo.com.br/next" } }));
    global.fetch = fetchSpy as never;

    const result = await analyzeWebsite("https://clinicaexemplo.com.br");

    expect(result).toBeNull();
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(4); // MAX_REDIRECTS + 1
  });

  it("returns null (never throws) on a network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as never;
    await expect(analyzeWebsite("https://clinicaexemplo.com.br")).resolves.toBeNull();
  });

  it("returns null on a non-2xx final response", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response("not found", { status: 404 })) as never;
    const result = await analyzeWebsite("https://clinicaexemplo.com.br");
    expect(result).toBeNull();
  });
});
