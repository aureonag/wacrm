import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
type Element = ReactElement<Record<string, unknown>>;
const mocks = vi.hoisted(() => ({
  current: null as HookHarness | null,
  auth: { user: { id: "member" } as { id: string } | null, accountId: "aureon" as string | null, profileLoading: false },
  pathname: "/dashboard",
}));
const sameDeps = (previous: readonly unknown[] | undefined, next: readonly unknown[]) => previous !== undefined && previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]));
function hooks() {
  if (!mocks.current) throw new Error("Hook outside its fixture");
  return mocks.current;
}
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState<T>(initial: T) {
    const runner = hooks(), slot = runner.slots[runner.cursor++] ??= { value: initial };
    slot.setter ??= next => {
      if (!runner.mounted) { runner.updatesAfterUnmount++; return; }
      const value = typeof next === "function" ? next(slot.value) : next;
      if (!Object.is(value, slot.value)) { slot.value = value; runner.dirty = true; }
    };
    return [slot.value as T, slot.setter];
  },
  useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
    const runner = hooks(), slot = runner.slots[runner.cursor++] ??= {};
    if (!sameDeps(slot.deps, deps)) {
      slot.deps = deps;
      runner.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
// A component using Next Link would retain this function type, not the native a.
vi.mock("next/link", () => ({ default: function RouterLink() { throw new Error("Router navigation is not the office entry"); } }));
vi.mock("lucide-react", () => ({ Building2: "svg" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/utils", () => ({ cn: (...values: string[]) => values.filter(Boolean).join(" ") }));

import { OfficeNavLink } from "./office-nav-link";

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
/** Uses the component's hooks and cleanup, without claiming browser DOM validation. */
class HookHarness {
  cursor = 0;
  slots: Slot[] = [];
  effects: (() => void)[] = [];
  dirty = false;
  mounted = true;
  updatesAfterUnmount = 0;
  output: unknown;
  flush() {
    let passes = 0;
    do {
      if (++passes > 10) throw new Error("Unexpected render loop");
      this.dirty = false; this.cursor = 0; mocks.current = this;
      try { this.output = OfficeNavLink(); } finally { mocks.current = null; }
      for (const effect of this.effects.splice(0)) effect();
    } while (this.dirty);
  }
  anchor() { return elements(this.output).find(element => element.type === "a"); }
  unmount() { this.mounted = false; for (const slot of this.slots) slot.cleanup?.(); }
}
let runner: HookHarness;
let fetchMock: ReturnType<typeof vi.fn>;
const response = (userId = "member", accountId = "aureon") => ({ ok: true, json: async () => ({ user: { id: userId }, accountId }) });
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); runner.flush(); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

beforeEach(() => {
  mocks.auth = { user: { id: "member" }, accountId: "aureon", profileLoading: false };
  mocks.pathname = "/dashboard";
  fetchMock = vi.fn().mockResolvedValue(response());
  vi.stubGlobal("fetch", fetchMock);
  runner = new HookHarness();
});
afterEach(() => { if (runner.mounted) runner.unmount(); vi.unstubAllGlobals(); });

describe("OfficeNavLink verified native entry", () => {
  it("only offers a native same-tab anchor after verifying the current CRM grant", async () => {
    runner.flush(); expect(runner.output).toBeNull(); await settle();
    const link = runner.anchor();
    expect(link?.props.href).toBe("/escritorio");
    expect(link?.props.target).toBeUndefined();
    expect(link?.props.onClick).toBeUndefined();
    expect(link?.props.onNavigate).toBeUndefined();
    expect(link?.props.onMouseEnter).toBeUndefined();
    expect(link?.props.prefetch).toBeUndefined();
    expect(link?.props.className).toContain("flex items-center gap-3 rounded-lg");
    expect(link?.props.className).toContain("text-muted-foreground hover:bg-muted");
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/office/context", expect.objectContaining({ credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(elements(runner.output).some(element => typeof element.type === "function")).toBe(false);
  });

  it.each(["/escritorio", "/escritorio/detalhe"])("preserves selected styling and accessibility on %s", async pathname => {
    mocks.pathname = pathname; runner.flush(); await settle();
    expect(runner.anchor()?.props["aria-current"]).toBe("page");
    expect(runner.anchor()?.props.className).toContain("bg-primary/10 text-primary");
  });

  it.each(["signed out", "profile loading", "no account"])("keeps the entry hidden and avoids requests while %s", async state => {
    if (state === "signed out") mocks.auth.user = null;
    if (state === "profile loading") mocks.auth.profileLoading = true;
    if (state === "no account") mocks.auth.accountId = null;
    runner.flush(); await settle();
    expect(runner.output).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["rejected", "network", "wrong user", "wrong account"])("does not grant the entry after %s context", async state => {
    if (state === "rejected") fetchMock.mockResolvedValueOnce({ ok: false });
    if (state === "network") fetchMock.mockRejectedValueOnce(new Error("controlled offline"));
    if (state === "wrong user") fetchMock.mockResolvedValueOnce(response("other"));
    if (state === "wrong account") fetchMock.mockResolvedValueOnce(response("member", "other"));
    runner.flush(); await settle(); expect(runner.output).toBeNull();
  });

  it("hides an old grant immediately when identity changes and ignores its late request", async () => {
    runner.flush(); await settle(); expect(runner.anchor()).toBeDefined();
    const pending = deferred<ReturnType<typeof response>>(); fetchMock.mockReturnValueOnce(pending.promise);
    mocks.auth = { user: { id: "second" }, accountId: "aureon", profileLoading: false }; runner.flush();
    const secondSignal = fetchMock.mock.calls[1][1].signal;
    expect(runner.output).toBeNull();
    mocks.auth = { user: { id: "third" }, accountId: "aureon", profileLoading: false };
    const newest = deferred<ReturnType<typeof response>>(); fetchMock.mockReturnValueOnce(newest.promise); runner.flush();
    expect(secondSignal.aborted).toBe(true); pending.resolve(response("second")); await settle(); expect(runner.output).toBeNull();
    newest.resolve(response("third")); await settle(); expect(runner.anchor()?.props.href).toBe("/escritorio");
  });

  it("aborts pending verification and ignores its completion after unmount", async () => {
    const pending = deferred<ReturnType<typeof response>>(); fetchMock.mockReturnValueOnce(pending.promise); runner.flush();
    const signal = fetchMock.mock.calls[0][1].signal; runner.unmount(); expect(signal.aborted).toBe(true);
    pending.resolve(response()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(runner.updatesAfterUnmount).toBe(0);
  });
});
