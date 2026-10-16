import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: { user: { id: "user-a" } as { id: string } | null, loading: false, accountId: "account-a", profileLoading: false },
}));
// Keep React and react-dom/server real. This file does not use the hook harness
// or replace lifecycle hooks; server rendering must naturally leave effects idle.
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));

import { OfficeFrame } from "./office-frame";

const markup = () => renderToStaticMarkup(createElement(OfficeFrame, { userId: "user-a", accountId: "account-a" }));

beforeEach(() => {
  mocks.auth = { user: { id: "user-a" }, loading: false, accountId: "account-a", profileLoading: false };
});

describe("OfficeFrame real server rendering before hydration", () => {
  it("keeps the iframe inert until client effects can arm its authenticated source", () => {
    expect(typeof window).toBe("undefined");
    const html = markup();
    const iframe = html.match(/<iframe\b[^>]*>/)?.[0];
    expect(iframe).toBeDefined();
    expect(iframe).not.toMatch(/\s(?:src|srcdoc)=/i);
  });

  it("preserves the opening shell, full-screen fallback and media policy in server HTML", () => {
    const html = markup();
    expect(html).toContain("Escritório Aureon");
    expect(html).toContain("Abrindo escritório");
    expect(html).toContain('href="/api/office/runtime/index.html"');
    expect(html).toContain("Abrir em tela cheia");
    expect(html).toContain('title="Escritório virtual Aureon"');
    expect(html).toContain("camera &#x27;self&#x27;; microphone &#x27;self&#x27;; display-capture &#x27;self&#x27;; autoplay &#x27;self&#x27;; fullscreen &#x27;self&#x27;");
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it.each(["user", "account"])("still closes a mismatched %s before rendering a runtime frame", field => {
    if (field === "user") mocks.auth.user = { id: "user-b" };
    else mocks.auth.accountId = "account-b";
    const html = markup();
    expect(html).not.toContain("<iframe");
    expect(html).toContain("Sua sessão do escritório foi encerrada");
    expect(html).toContain('href="/login?next=%2Fescritorio"');
  });
});
