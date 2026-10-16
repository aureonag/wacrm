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
  frame: { key: string | null; node: { contentWindow: object; contentDocument: { contentType: string }; src: string | null; getAttribute(name: string): string | null }; ref: { current: unknown } } | null = null;
  navigations: string[] = [];
  renderOnce() {
    this.dirty = false;
    this.cursor = 0;
    mocks.current = this;
    try { this.output = OfficeFrame({ userId: "user-a", accountId: "account-a" }); }
    finally { mocks.current = null; }
    const frame = this.find("iframe");
    if (!frame || frame.key !== this.frame?.key) {
      if (this.frame) this.frame.ref.current = null;
      this.frame = frame ? { key: frame.key, node: { contentWindow: {}, contentDocument: { contentType: "text/html" }, src: null,
        getAttribute(name: string) { return name === "src" ? this.src : null; } }, ref: frame.props.ref as { current: unknown } } : null;
    }
    if (this.frame && frame) {
      const nextSource = typeof frame.props.src === "string" ? frame.props.src : null;
      if (nextSource !== this.frame.node.src && nextSource !== null) this.navigations.push(nextSource);
      this.frame.node.src = nextSource;
      this.frame.ref.current = this.frame.node;
    }
  }
  commitEffects() { for (const effect of this.effects.splice(0)) effect(); }
  flush() {
    let passes = 0;
    do {
      if (++passes > 10) throw new Error("Unexpected render loop");
      this.renderOnce();
      this.commitEffects();
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
  function inertFirstCommit() {
    runner.unmount();
    runner = new HookHarness();
    runner.renderOnce();
    const frame = runner.frame!.node;
    const onLoad = runner.find("iframe")!.props.onLoad as () => void;
    const onError = runner.find("iframe")!.props.onError as () => void;
    runner.commitEffects();
    // State updates have been queued by client effects, but the source-bearing
    // render has not committed. The same iframe/window must survive this step.
    return { frame, onLoad, onError };
  }

  it("does not navigate or start an opening deadline while its first frame is inert", async () => {
    const { frame } = inertFirstCommit();
    expect(runner.find("iframe")?.props.src).toBeUndefined();
    expect(runner.navigations).toEqual([]);
    expect(vi.getTimerCount()).toBe(1); // Context verification, no opening deadline.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runner.label()).toContain("Abrindo escritório");
    expect(runner.find("iframe")?.props.src).toBeUndefined();
    runner.flush();
    expect(runner.frame!.node).toBe(frame);
    expect(runner.navigations).toEqual(["/api/office/runtime/index.html"]);
    await advance(89_999);
    expect(runner.label()).toContain("Abrindo escritório");
    await advance(1);
    expect(runner.label()).toContain("O escritório está indisponível");
  });

  it("ignores readiness and load/error events from the inert document, then accepts readiness from the armed window", () => {
    const { frame, onLoad, onError } = inertFirstCommit();
    for (const type of ["aureon-office-ready", "aureon-office-unavailable", "aureon-office-session-ended"]) {
      for (const listener of listeners.get("message") ?? []) listener({ origin: "https://crm.test", source: frame.contentWindow, data: { type } } as MessageEvent);
    }
    frame.contentDocument.contentType = "application/json";
    onLoad(); onError();
    runner.flush();
    expect(runner.label()).toContain("Abrindo escritório");
    expect(runner.find("iframe")?.props.src).toBe("/api/office/runtime/index.html");
    frame.contentDocument.contentType = "text/html";
    message("aureon-office-ready", frame.contentWindow);
    expect(runner.label()).not.toContain("Abrindo escritório");
  });

  it("still revokes an inert frame when the CRM context check denies access", async () => {
    inertFirstCommit();
    fetchMock.mockResolvedValue({ status: 403 });
    await vi.advanceTimersByTimeAsync(15_000);
    runner.flush();
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada");
    expect(runner.find("iframe")).toBeUndefined();
    expect(runner.navigations).toEqual([]);
  });

  it("arms a retry only after its new window listeners exist and starts a fresh deadline on source commit", async () => {
    const oldWindow = runner.frame!.node.contentWindow;
    await advance(90_000);
    (runner.find("button")!.props.onClick as () => void)();
    runner.renderOnce();
    const nextWindow = runner.frame!.node.contentWindow;
    expect(nextWindow).not.toBe(oldWindow);
    expect(runner.find("iframe")?.props.src).toBeUndefined();
    runner.commitEffects();
    for (const listener of listeners.get("message") ?? []) listener({ origin: "https://crm.test", source: oldWindow, data: { type: "aureon-office-ready" } } as MessageEvent);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(runner.label()).toContain("Abrindo escritório");
    expect(runner.find("iframe")?.props.src).toBeUndefined();
    runner.flush();
    expect(runner.frame!.node.contentWindow).toBe(nextWindow);
    expect(runner.navigations).toEqual(["/api/office/runtime/index.html", "/api/office/runtime/index.html"]);
    await advance(89_999);
    expect(runner.label()).toContain("Abrindo escritório");
    await advance(1);
    expect(runner.label()).toContain("O escritório está indisponível");
  });

  it("ignores messages from its own frame until the canonical src is committed", () => {
    runner.frame!.node.src = null;
    message("aureon-office-ready");
    expect(runner.label()).toContain("Abrindo escritório");
    runner.frame!.node.src = "/unrelated";
    message("aureon-office-unavailable");
    expect(runner.label()).toContain("Abrindo escritório");
    runner.frame!.node.src = "/api/office/runtime/index.html";
    message("aureon-office-ready");
    expect(runner.label()).not.toContain("Abrindo escritório");
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
  });

  it.each([401, 403])("keeps a context %s terminal across late messages", async status => {
    fetchMock.mockResolvedValue({ status });
    await advance(15_000);
    message("aureon-office-ready");
    message("aureon-office-unavailable");
    expect(runner.label()).toContain("Sua sessão do escritório foi encerrada");
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
