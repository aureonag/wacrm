import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), enabled: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("lucide-react", () => ({ Building2: "svg", LockKeyhole: "svg" }));
vi.mock("@/components/ui/alert", () => ({ Alert: "aside", AlertTitle: "h2", AlertDescription: "p" }));
vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "button" }));
vi.mock("@/lib/auth/account", () => ({ UnauthorizedError: class extends Error {}, ForbiddenError: class extends Error {} }));
vi.mock("@/lib/office/access", () => ({ getOfficeContext: mocks.context, OfficeConfigurationError: class extends Error {} }));
vi.mock("@/lib/office/runtime/server", () => ({ isOfficeEnabled: mocks.enabled }));

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { OfficeConfigurationError } from "@/lib/office/access";
import OfficePage from "./page";

type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : "";
}
class Navigation extends Error {
  constructor(readonly destination: string) { super("NEXT_REDIRECT"); }
}

beforeEach(() => {
  mocks.context.mockReset().mockResolvedValue({ user: { id: "member", name: "Ana" }, accountId: "aureon" });
  mocks.enabled.mockReset().mockReturnValue(true);
  mocks.redirect.mockReset().mockImplementation((destination: string) => { throw new Navigation(destination); });
});

describe("OfficePage authenticated full-document entry", () => {
  it("redirects an enabled, verified member to the existing private runtime", async () => {
    await expect(OfficePage()).rejects.toMatchObject({ destination: "/api/office/runtime/index.html" });
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.enabled).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/api/office/runtime/index.html");
    expect(mocks.context.mock.invocationCallOrder[0]).toBeLessThan(mocks.enabled.mock.invocationCallOrder[0]);
    expect(mocks.enabled.mock.invocationCallOrder[0]).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);
  });

  it("waits for authorization before deciding whether to enter the runtime", async () => {
    let allow!: (value: unknown) => void;
    mocks.context.mockReturnValueOnce(new Promise(resolve => { allow = resolve; }));
    const pending = OfficePage();
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    allow({ user: { id: "member", name: "Ana" }, accountId: "aureon" });
    await expect(pending).rejects.toMatchObject({ destination: "/api/office/runtime/index.html" });
  });

  it("sends an unauthenticated visitor to CRM login without opening the runtime", async () => {
    mocks.context.mockRejectedValueOnce(new UnauthorizedError());
    await expect(OfficePage()).rejects.toMatchObject({ destination: "/login?next=%2Fescritorio" });
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login?next=%2Fescritorio");
    expect(mocks.enabled).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", () => new ForbiddenError(), "Acesso exclusivo à equipe Aureon", "Entre no CRM com seu usuário vinculado à conta Aureon para acessar este espaço."],
    ["missing configuration", () => new OfficeConfigurationError(), "O escritório está em preparação", "Você poderá entrar por aqui quando o escritório estiver disponível."],
  ] as const)("preserves the %s explanation and CRM return", async (_label, failure, title, explanation) => {
    mocks.context.mockRejectedValueOnce(failure());
    const result = await OfficePage();
    expect(text(result)).toContain(title);
    expect(text(result)).toContain(explanation);
    expect(elements(result).find(element => element.type === "a")?.props.href).toBe("/dashboard");
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the preparation screen when a verified member reaches a disabled office", async () => {
    mocks.enabled.mockReturnValueOnce(false);
    const result = await OfficePage();
    expect(text(result)).toContain("Olá, Ana.");
    expect(text(result)).toContain("Estamos preparando seu escritório");
    expect(elements(result).find(element => element.type === "a")?.props.href).toBe("/dashboard");
    expect(elements(result).some(element => element.type === "iframe")).toBe(false);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("preserves unexpected authorization failures instead of granting access or disguising the error", async () => {
    const error = new Error("controlled test failure");
    mocks.context.mockRejectedValueOnce(error);
    await expect(OfficePage()).rejects.toBe(error);
    expect(mocks.enabled).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
