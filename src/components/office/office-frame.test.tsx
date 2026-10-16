import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HookSlot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
type FrameElement = ReactElement<Record<string, unknown>>;
type Listener = (event: MessageEvent) => void;

const mocks = vi.hoisted(() => ({
  current: null as HookHarness | null,
  auth: { user: { id: "user-a" } as { id: string } | null, loading: false, accountId: "account-a", profileLoading: false },
  stop: vi.fn(),
}));

function hooks() {
  if (!mocks.current) throw new Error("A hook ran outside the component fixture");
  return mocks.current;
}
function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[]) {
  return a !== undefined && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef<T>(value: T) {
    const runner = hooks(), index = runner.cursor++;
    return (runner.slots[index] ??= { value: { current: value } }).value as { current: T };
  },
  useState<T>(initial: T) {
    const runner = hooks(), index = runner.cursor++;
    const slot = runner.slots[index] ??= { value: initial };
    slot.setter ??= next => {
      if (!runner.mounted) { runner.updatesAfterUnmount += 1; return; }
      const value = typeof next === "function" ? next(slot.value) : next;
      if (!Object.is(slot.value, value)) { slot.value = value; runner.dirty = true; }
    };
    return [slot.value as T, slot.setter];
  },
  useCallback<T>(callback: T, deps: readonly unknown[]) {
    const runner = hooks(), index = runner.cursor++;
    const slot = runner.slots[index] ??= {};
    if (!sameDeps(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
    return slot.value as T;
  },
  useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
    const runner = hooks(), index = runner.cursor++;
    const slot = runner.slots[index] ??= {};
    if (!sameDeps(slot.deps, deps)) {
      slot.deps = deps;
      runner.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; });
    }
  },
}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("lucide-react", () => ({ Building2: "svg" }));
vi.mock("@/components/ui/alert", () => ({ Alert: "aside", AlertTitle: "h2", AlertDescription: "p" }));
vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "button" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/office/context-status", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/office/context-status")>(),
  stopOfficeFrameMedia: mocks.stop,
}));

import { OfficeFrame } from "./office-frame";

function elements(node: unknown): FrameElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as FrameElement;
  return [element, ...elements(element.props.children)];
}
function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "props" in node) return text((node as FrameElement).props.children);
  return "";
}

/** Runs the component's own hooks/effect cleanup in Node; this is not browser/React DOM validation. */
class HookHarness {
  cursor = 0;
  slots: HookSlot[] = [];
  effects: (() => void)[] = [];
  dirty = false;
  mounted = true;
  updatesAfterUnmount = 0;
  output: unknown;
  firstOutput: unknown;
  frame: { key: string | null; node: { contentWindow: object; contentDocument: { contentType: string } }; ref: { current: unknown } } | null = null;
  flush() {
    let passes = 0;
    do {
      if (++passes > 10) throw new Error("Unexpected render loop");
      this.dirty = false;
      this.cursor = 0;
      mocks.current = this;
      try { this.output = OfficeFrame({ userId: "user-a", accountId: "account-a" }); this.firstOutput ??= this.output; }
      finally { mocks.current = null; }
      const frame = this.find("iframe");
      if (!frame || frame.key !== this.frame?.key) {
        if (this.frame) this.frame.ref.current = null;
        this.frame = frame ? { key: frame.key, node: { contentWindow: {}, contentDocument: { contentType: "text/html" } }, ref: frame.props.ref as { current: unknown } } : null;
      }
      if (this.frame) this.frame.ref.current = this.frame.node;
      for (const effect of this.effects.splice(0)) effect();
    } while (this.dirty);
  }
  find(type: string) { return elements(this.output).find(element => element.type === type); }
  label() { return text(this.output); }
  unmount() {
    this.mounted = false;
    if (this.frame) this.frame.ref.current = null;
    this.frame = null;
    for (const slot of this.slots) slot.cleanup?.();
  }
}

let runner: HookHarness;
let listeners: Map<string, Set<Listener>>;
let fetchMock: ReturnType<typeof vi.fn>;
function message(type: string, source: object | null = runner.frame?.node.contentWindow ?? null, origin = "https://crm.test") {
  for (const listener of [...listeners.get("message") ?? []]) listener({ origin, source, data: { type } } as MessageEvent);
  runner.flush();
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  runner.flush();
}
function focus() {
  for (const listener of [...listeners.get("focus") ?? []]) listener({} as MessageEvent);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function runtimeLink() {
  return elements(runner.output).find(element => element.type === "a" && element.props.href === "/api/office/runtime/index.html");
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.auth = { user: { id: "user-a" }, loading: false, accountId: "account-a", profileLoading: false };
  listeners = new Map();
  vi.stubGlobal("window", {
    location: { origin: "https://crm.test" },
    setTimeout, clearTimeout, setInterval, clearInterval,
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
  });
  fetchMock = vi.fn().mockResolvedValue({ status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  runner = new HookHarness();
  runner.flush();
});
afterEach(() => {
  if (runner.mounted) runner.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("OfficeFrame opening deadline and session boundary", () => {
  it("defers iframe navigation until the client commit, preserving one authenticated frame", () => {
    const firstFrame = elements(runner.firstOutput).find(element => element.type === "iframe");
    expect(firstFrame?.props.src).toBeUndefined();
    expect(runner.find("iframe")?.props.src).toBe("/api/office/runtime/index.html");
    expect(firstFrame?.props.ref).toBe(runner.find("iframe")?.props.ref);
  });
  it("uses the canonical authenticated document and expires opening exactly at 90 seconds", async () => {
    const target = runner.frame!.node.contentWindow;
    expect(runner.find("iframe")?.props.src).toBe("/api/office/runtime/index.html");
    expect(runner.find("iframe")?.props.allow).toBe("camera 'self'; microphone 'self'; display-capture 'self'; autoplay 'self'; fullscreen 'self'");
    await advance(89_999);
    expect(runner.label()).toContain("Abrindo escritório");
    await advance(1);
    expect(runner.label()).toContain("O escritório está indisponível");
    expect(runner.find("iframe")).toBeUndefined();
    expect(mocks.stop).toHaveBeenCalledWith(target);
  });

  it("cancels the deadline when a timely ready message arrives", async () => {
    await advance(89_999);
    message("aureon-office-ready");
    expect(runner.label()).not.toContain("Abrindo escritório");
    await advance(90_001);
    expect(runner.find("iframe")).toBeDefined();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1); // Only the context verification interval remains.
  });

  it("ignores foreign origins and other frame windows", async () => {
    message("aureon-office-ready", {}, "https://crm.test");
    message("aureon-office-ready", runner.frame!.node.contentWindow, "https://other.test");
    message("aureon-office-session-ended", {}, "https://crm.test");
    expect(runner.label()).toContain("Abrindo escritório");
    await advance(90_000);
    expect(runner.label()).toContain("O escritório está indisponível");
  });

  it("keeps timed out attempts closed, then remounts with a new window and full deadline", async () => {
    const oldWindow = runner.frame!.node.contentWindow;
    const oldLoad = runner.find("iframe")!.props.onError as () => void;
    await advance(90_000);
    message("aureon-office-ready", oldWindow);
    message("aureon-office-unavailable", oldWindow);
    expect(runner.label()).toContain("O escritório está indisponível");
    (runner.find("button")!.props.onClick as () => void)();
    runner.flush();
    expect(runner.find("iframe")?.key).toBe("1");
    expect(runner.frame!.node.contentWindow).not.toBe(oldWindow);
    oldLoad();
    message("aureon-office-ready", oldWindow);
    expect(runner.label()).toContain("Abrindo escritório");
    await advance(89_999);
    message("aureon-office-ready");
    await advance(1);
    expect(runner.find("iframe")).toBeDefined();
    expect(runner.label()).not.toContain("Abrindo escritório");
  });

  it("does not revive an expired session on late ready, unavailable or context success", async () => {
    const oldWindow = runner.frame!.node.contentWindow;
    message("aureon-office-session-ended");
    message("aureon-office-ready", oldWindow);
    message("aureon-office-unavailable", oldWindow);
    await advance(90_000);
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada");
    expect(runner.find("button")).toBeUndefined();
    expect(runner.find("a")?.props.href).toBe("/login?next=%2Fescritorio");
    expect(runtimeLink()).toBeUndefined();
  });

  it.each(["user", "account"])("permanently closes when the authenticated %s changes", async field => {
    const target = runner.frame!.node.contentWindow;
    if (field === "user") mocks.auth.user = { id: "user-b" };
    else mocks.auth.accountId = "account-b";
    runner.flush();
    expect(mocks.stop).toHaveBeenCalledWith(target);
    mocks.auth.user = { id: "user-a" };
    mocks.auth.accountId = "account-a";
    runner.flush();
    message("aureon-office-ready", target);
    await advance(90_000);
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada");
    expect(runtimeLink()).toBeUndefined();
  });

  it.each([401, 403])("keeps a context %s terminal across late messages", async status => {
    fetchMock.mockResolvedValue({ status });
    await advance(15_000);
    message("aureon-office-ready");
    message("aureon-office-unavailable");
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada");
    expect(runtimeLink()).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/office/context", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  });

  it("cleans timers/listeners and rejects pending callbacks after unmount", async () => {
    let resolve: (value: { status: number }) => void = () => {};
    fetchMock.mockImplementation(() => new Promise(value => { resolve = value; }));
    await advance(15_000);
    const staleMessage = [...listeners.get("message")!][0];
    const oldWindow = runner.frame!.node.contentWindow;
    const staleError = runner.find("iframe")!.props.onError as () => void;
    runner.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(listeners.get("message")?.size).toBe(0);
    expect(listeners.get("focus")?.size).toBe(0);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ status: 401 });
    await Promise.resolve();
    staleError();
    staleMessage({ origin: "https://crm.test", source: oldWindow, data: { type: "aureon-office-ready" } } as MessageEvent);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(runner.updatesAfterUnmount).toBe(0);
  });

  it("closes a non-HTML response or load error and never accepts late readiness", () => {
    const target = runner.frame!.node.contentWindow;
    runner.frame!.node.contentDocument.contentType = "application/json";
    (runner.find("iframe")!.props.onLoad as () => void)();
    runner.flush();
    message("aureon-office-ready", target);
    expect(runner.label()).toContain("O escritório está indisponível");
  });
});

describe("OfficeFrame existing other-tab links", () => {
  it.each(["opening", "ready", "unavailable"])("offers the same passive authenticated link while %s", phase => {
    const target = runner.frame!.node.contentWindow;
    if (phase === "ready") message("aureon-office-ready");
    if (phase === "unavailable") message("aureon-office-unavailable");
    const links = elements(runner.output).filter(element => element.type === "a" && element.props.href === "/api/office/runtime/index.html");
    expect(links).toHaveLength(1);
    expect(text(links[0])).toBe("Abrir em outra guia");
    expect(links[0].props).toMatchObject({target: "_blank", rel: "noopener noreferrer", title: "Abre o escritório em outra guia do navegador"});
    expect(links[0].props.onClick).toBeUndefined();
    if (phase === "unavailable") {
      expect(runner.label()).toContain("Não conseguimos abrir o espaço nesta tela. Tente novamente ou abra em outra guia.");
      expect(runner.find("iframe")).toBeUndefined();
      expect(mocks.stop).toHaveBeenCalledWith(target);
    } else {
      expect(runner.frame!.node.contentWindow).toBe(target);
      expect(runner.find("iframe")?.props.src).toBe("/api/office/runtime/index.html");
      expect(mocks.stop).not.toHaveBeenCalled();
    }
  });
});

describe("OfficeFrame bounded context verification", () => {
  it("deduplicates focus storms and an interval tick while one check is active, then uses a fresh controller", async () => {
    const pending = deferred<{status: number}>(); fetchMock.mockReturnValueOnce(pending.promise);
    await advance(14_000);
    for (let i = 0; i < 20; i++) focus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstSignal = fetchMock.mock.calls[0][1].signal;
    await advance(1_000); focus();
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(firstSignal.aborted).toBe(false);
    pending.resolve({status: 200}); await advance(0);
    focus(); await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].signal).not.toBe(firstSignal);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
    expect(runner.label()).toContain("Abrindo escritório");
  });

  it.each([401, 403, 503])("ignores a late fetch %s after timeout and its finally cannot release a newer check", async status => {
    const old = deferred<{status: number; json?: () => Promise<unknown>}>(), fresh = deferred<{status: number}>();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    focus(); const oldSignal = fetchMock.mock.calls[0][1].signal;
    await advance(9_999); expect(oldSignal.aborted).toBe(false);
    await advance(1); expect(oldSignal.aborted).toBe(true);
    expect(runner.label()).toContain("Abrindo escritório"); expect(mocks.stop).not.toHaveBeenCalled();
    focus(); const freshSignal = fetchMock.mock.calls[1][1].signal;
    expect(freshSignal).not.toBe(oldSignal); expect(freshSignal.aborted).toBe(false);
    const json = vi.fn().mockResolvedValue({code: "OFFICE_FEATURE_DISABLED"});
    old.resolve({status, json}); await advance(0);
    expect(json).not.toHaveBeenCalled(); expect(runner.label()).toContain("Abrindo escritório");
    focus(); expect(fetchMock).toHaveBeenCalledTimes(2); expect(freshSignal.aborted).toBe(false);
    fresh.resolve({status: 403}); await advance(0);
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada"); expect(runtimeLink()).toBeUndefined();
  });

  it("bounds a stalled 503 JSON body too and ignores its late rollback without clearing the newer deadline", async () => {
    const body = deferred<unknown>(), newer = deferred<{status: number}>();
    const json = vi.fn().mockReturnValue(body.promise);
    fetchMock.mockResolvedValueOnce({status: 503, json}).mockReturnValueOnce(newer.promise);
    focus(); await advance(0); expect(json).toHaveBeenCalledTimes(1);
    const oldSignal = fetchMock.mock.calls[0][1].signal;
    await advance(10_000); expect(oldSignal.aborted).toBe(true);
    focus(); const newSignal = fetchMock.mock.calls[1][1].signal;
    body.resolve({code: "OFFICE_FEATURE_DISABLED"}); await advance(0); focus();
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(runner.label()).toContain("Abrindo escritório");
    expect(mocks.stop).not.toHaveBeenCalled();
    await advance(9_999); expect(newSignal.aborted).toBe(false);
    await advance(1); expect(newSignal.aborted).toBe(true);
    focus(); await advance(0); expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1].signal.aborted).toBe(false);
  });

  it.each([401, 403])("keeps an in-time %s revocation sticky even if its iframe attempt was retried", async status => {
    const pending = deferred<{status: number}>(); fetchMock.mockReturnValueOnce(pending.promise);
    focus(); await advance(2_000);
    message("aureon-office-unavailable");
    (runner.find("button")!.props.onClick as () => void)(); runner.flush();
    expect(runner.find("iframe")?.key).toBe("1");
    pending.resolve({status}); await advance(0);
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada"); expect(runtimeLink()).toBeUndefined();
    message("aureon-office-ready");
    expect(runner.find("iframe")).toBeUndefined();
  });

  it("does not apply an in-time rollback JSON from a previous iframe attempt to a retry", async () => {
    const body = deferred<unknown>(); fetchMock.mockResolvedValueOnce({status: 503, json: () => body.promise});
    focus(); await advance(0);
    message("aureon-office-unavailable");
    (runner.find("button")!.props.onClick as () => void)(); runner.flush();
    body.resolve({code: "OFFICE_FEATURE_DISABLED"}); await advance(0);
    expect(runner.find("iframe")?.key).toBe("1"); expect(runner.label()).toContain("Abrindo escritório");
    message("aureon-office-ready"); expect(runner.label()).not.toContain("Abrindo escritório");
  });

  it("applies an explicit rollback to its active attempt without classifying it as an expired login", async () => {
    fetchMock.mockResolvedValueOnce({status: 503, json: async () => ({code: "OFFICE_FEATURE_DISABLED"})});
    message("aureon-office-ready"); focus(); await advance(0);
    expect(runner.label()).toContain("O escritório está indisponível");
    expect(runner.label()).not.toContain("Sua sessão do escritório foi encerrada");
    expect(runtimeLink()).toBeDefined(); expect(runner.find("button")).toBeDefined();
  });

  it.each(["network", "service-unavailable", "invalid-json"])("treats %s as temporary and releases the request for a later check", async failure => {
    if (failure === "network") fetchMock.mockRejectedValueOnce(Error("offline"));
    else fetchMock.mockResolvedValueOnce({status: 503, json: failure === "invalid-json" ? async () => { throw Error("bad json"); } : async () => ({error: "Temporary"})});
    focus(); await advance(0);
    expect(runner.label()).toContain("Abrindo escritório"); expect(mocks.stop).not.toHaveBeenCalled();
    focus(); await advance(0); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
  });

  it("aborts a pending body and clears its own deadline, interval and focus listener on unmount", async () => {
    const body = deferred<unknown>(); fetchMock.mockResolvedValueOnce({status: 503, json: () => body.promise});
    focus(); await advance(0);
    const signal = fetchMock.mock.calls[0][1].signal, staleFocus = [...listeners.get("focus")!][0];
    expect(signal.aborted).toBe(false); runner.unmount();
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(listeners.get("focus")?.size).toBe(0); expect(listeners.get("message")?.size).toBe(0);
    staleFocus({} as MessageEvent); expect(fetchMock).toHaveBeenCalledTimes(1);
    body.resolve({code: "OFFICE_FEATURE_DISABLED"}); await vi.advanceTimersByTimeAsync(20_000);
    expect(runner.updatesAfterUnmount).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
