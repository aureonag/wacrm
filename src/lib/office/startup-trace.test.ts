import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { OFFICE_STARTUP_TRACE_SCRIPT } from "./startup-trace";

type Callback = (event: Record<string, unknown>) => void;
type TraceEvent = Record<string, unknown> & { kind: string };
type Trace = { version: number; state: string; stopReason?: string; events: TraceEvent[] };

class Target {
  listeners = new Map<string, Set<Callback>>();
  addEventListener(type: string, callback: Callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(callback);
  }
  removeEventListener(type: string, callback: Callback) { this.listeners.get(type)?.delete(callback); }
  dispatch(type: string, detail: Record<string, unknown> = {}) {
    for (const callback of [...this.listeners.get(type) ?? []]) callback({ type, target: this, ...detail });
  }
  listenerCount() { return [...this.listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0); }
}

class Element extends Target {
  nodeType = 1;
  isConnected = true;
  parentElement: Element | null = null;
  attributes = new Map<string, string>();
  children: Element[] = [];
  constructor(public tagName: string, attributes: Record<string, string> = {}) {
    super();
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  contains(node: Element): boolean { return node === this || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector: string): Element[] {
    if (!selector.includes("iframe")) return [];
    return this.children.flatMap(child => [...(child.tagName === "IFRAME" ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  closest(selector: string): Element | null {
    if (selector.includes("data-office-frame-phase") && this.hasAttribute("data-office-frame-phase")) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

class Frame extends Element {
  contentWindow = {};
  contentDocument = {
    URL: "about:blank", readyState: "complete", contentType: "text/html",
    documentElement: new Element("HTML"),
    getElementById: () => null,
  };
  constructor(title = "Escritório virtual Aureon", src = "/api/office/runtime/index.html") {
    super("IFRAME", { title, src });
  }
  get src() { return new URL(this.getAttribute("src") || "about:blank", "https://crm.test").href; }
  get title() { return this.getAttribute("title") || ""; }
}

/** Executes only the small diagnostic script with fake DOM/timers; no browser or CRM runs. */
function fixture(frames: Frame[] = [new Frame()], pathname = "/escritorio") {
  let clock = 0, timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const root = new Element("HTML");
  const parent = new Element("SECTION", { "data-office-frame-phase": "opening", "data-office-frame-attempt": "0" });
  root.children = [parent]; parent.children = frames;
  for (const frame of frames) frame.parentElement = parent;
  const document = {
    documentElement: root,
    querySelectorAll: (selector: string) => selector.includes("iframe") ? frames.filter(frame => frame.isConnected) : [],
    querySelector: (selector: string) => selector.includes("data-office-frame-phase") ? parent : null,
  };
  const mutations: Mutation[] = [], resources: Resource[] = [];
  class Mutation {
    disconnected = false;
    constructor(private callback: (records: Record<string, unknown>[]) => void) { mutations.push(this); }
    observe() { this.disconnected = false; }
    disconnect() { this.disconnected = true; }
    emit(records: Record<string, unknown>[]) { if (!this.disconnected) this.callback(records); }
  }
  class Resource {
    static supportedEntryTypes = ["resource"];
    disconnected = false;
    constructor(private callback: (entries: { getEntries: () => Record<string, unknown>[] }) => void) { resources.push(this); }
    observe() { this.disconnected = false; }
    disconnect() { this.disconnected = true; }
    emit(entries: Record<string, unknown>[]) { if (!this.disconnected) this.callback({ getEntries: () => entries }); }
  }
  const window = Object.assign(new Target(), {
    location: { pathname, origin: "https://crm.test", href: "https://crm.test" + pathname },
    performance: { now: () => clock, timeOrigin: 1_700_000_000_000, getEntriesByType: () => [] },
    setTimeout: (callback: () => void, delay = 0) => { const id = ++timerId; timers.set(id, { at: clock + delay, callback }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  });
  const context = { window, document, MutationObserver: Mutation, PerformanceObserver: Resource, URL, WeakMap, WeakSet, performance: window.performance };
  function run() { runInNewContext(OFFICE_STARTUP_TRACE_SCRIPT, context, { timeout: 1_000 }); }
  function trace() {
    const text = root.getAttribute("data-office-startup-trace");
    return text ? JSON.parse(text) as Trace : null;
  }
  function mutate(records: Record<string, unknown>[]) { for (const observer of mutations) observer.emit(records); }
  function resource(entries: Record<string, unknown>[]) { for (const observer of resources) observer.emit(entries); }
  function advance(ms: number) {
    const end = clock + ms;
    let count = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      if (++count > 10_000) throw new Error("Unexpected fixture timer loop");
      timers.delete(next[0]); clock = next[1].at; next[1].callback();
    }
    clock = end;
  }
  return { frames, parent, root, window, mutations, resources, timers, run, trace, mutate, resource, advance };
}

function id(event: TraceEvent) {
  const node = event.node;
  return node && typeof node === "object" ? (node as { id?: unknown }).id : node ?? event.nodeId;
}
function resourceEntry(name: string, extra: Record<string, unknown> = {}) {
  return { name, entryType: "resource", initiatorType: "iframe", startTime: 10, duration: 25,
    responseStart: 15, requestStart: 12, responseEnd: 35, transferSize: 1234, encodedBodySize: 1200, decodedBodySize: 2000,
    serverTiming: [], ...extra };
}

describe("temporary office startup diagnostic boundary", () => {
  it("runs only on the office route and observes only the exact canonical office iframe", () => {
    const unrelated = fixture([new Frame()], "/dashboard"); unrelated.run();
    expect(unrelated.trace()).toBeNull();
    expect(unrelated.window.listenerCount()).toBe(0);
    expect(unrelated.mutations).toHaveLength(0);
    expect(unrelated.timers.size).toBe(0);

    const accepted = new Frame();
    const app = fixture([accepted, new Frame("Other"), new Frame(undefined, "/api/office/runtime/index.html?token=SECRET"),
      new Frame(undefined, "https://outside.test/api/office/runtime/index.html"), new Frame(undefined, "/login")]);
    app.run();
    expect(app.trace()?.version).toBe(1);
    expect(app.trace()?.events.filter(event => event.kind === "snapshot")).toHaveLength(1);
    expect(JSON.stringify(app.trace())).not.toMatch(/SECRET|outside\.test|\/login/);
  });

  it("keeps the same node identity through removal and reinsertion, without recording foreign messages", () => {
    const app = fixture(); app.run();
    const frame = app.frames[0], initial = app.trace()!.events.find(event => event.kind === "snapshot")!;
    expect(id(initial)).toBeDefined();
    expect(initial).toMatchObject({ document: "blank", readyState: "complete", office: "unknown" });
    frame.contentDocument.URL = "https://crm.test/api/office/runtime/index.html";
    frame.contentDocument.readyState = "interactive";
    frame.contentDocument.documentElement.setAttribute("data-office-crm", "loading");
    frame.dispatch("load");
    expect(app.trace()!.events.at(-1)).toMatchObject({ kind: "load", document: "runtime", readyState: "interactive", office: "loading" });
    frame.isConnected = false;
    app.mutate([{ type: "childList", target: app.parent, addedNodes: [], removedNodes: [frame] }]);
    frame.isConnected = true;
    app.mutate([{ type: "childList", target: app.parent, addedNodes: [frame], removedNodes: [] }]);
    const moves = app.trace()!.events.filter(event => ["added", "removed"].includes(event.kind));
    expect(moves.map(id)).toEqual([id(initial), id(initial)]);
    const count = app.trace()!.events.length;
    for (const type of ["aureon-office-ready", "aureon-office-unavailable", "aureon-office-session-ended"]) {
      app.window.dispatch("message", { origin: "https://outside.test", source: frame.contentWindow, data: { type } });
      app.window.dispatch("message", { origin: "https://crm.test", source: {}, data: { type } });
    }
    app.window.dispatch("message", { origin: "https://crm.test", source: frame.contentWindow, data: { type: "SECRET", body: "SECRET" } });
    expect(app.trace()!.events).toHaveLength(count);
    for (const type of ["aureon-office-ready", "aureon-office-unavailable", "aureon-office-session-ended"])
      app.window.dispatch("message", { origin: "https://crm.test", source: frame.contentWindow, data: { type, body: "SECRET" } });
    expect(app.trace()!.events.filter(event => event.kind === "message")).toHaveLength(3);
    expect(JSON.stringify(app.trace())).not.toContain("SECRET");
  });

  it("limits resource telemetry to known same-origin paths and excludes URLs, descriptions and invalid numbers", () => {
    const app = fixture(); app.run();
    app.resource([
      resourceEntry("https://crm.test/api/office/runtime/index.html"),
      resourceEntry("https://crm.test/api/office/context", { startTime: Infinity, duration: NaN,
        serverTiming: [{ name: "SECRET_STAGE", description: "SECRET_DESCRIPTION", duration: 55 },
          { name: "office_auth", description: "SECRET", duration: NaN },
          { name: "office_auth", description: "SECRET", duration: 1 },
          { name: "office_asset", description: "SECRET", duration: 2 },
          { name: "office_route", description: "SECRET", duration: 3 },
          { name: "office_auth", description: "SECRET", duration: 4 }] }),
      resourceEntry("https://outside.test/api/office/runtime/index.html"),
      resourceEntry("https://crm.test/api/private?token=SECRET"),
      resourceEntry("https://crm.test/api/office/context?token=SECRET"),
    ]);
    const events = app.trace()!.events.filter(event => event.kind === "resource");
    expect(events).toHaveLength(2);
    expect(events[1].serverTiming).toEqual([{ name: "office_auth", duration: 1 }, { name: "office_asset", duration: 2 }, { name: "office_route", duration: 3 }]);
    expect(events[1].startTime).toBeNull();
    expect(events[1].duration).toBeNull();
    const text = JSON.stringify(events);
    expect(text).not.toMatch(/https?:|\/api\/|SECRET|description/);
    for (const event of events) for (const value of Object.values(event)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  });

  it("does not reattach listeners after a mutation batch exhausts the event budget", () => {
    const app = fixture([]); app.run();
    const frames = Array.from({ length: 105 }, () => new Frame());
    for (const frame of frames) frame.parentElement = app.parent;
    app.mutate([{ type: "childList", target: app.parent, addedNodes: frames, removedNodes: [] }]);
    expect(app.trace()!.events).toHaveLength(100);
    expect(app.trace()!.stopReason).toBe("limit");
    expect(frames.every(frame => frame.listenerCount() === 0)).toBe(true);
    expect(app.window.listenerCount()).toBe(0);
    expect(app.timers.size).toBe(0);
    const retained = app.root.getAttribute("data-office-startup-trace");
    app.run();
    expect(app.root.getAttribute("data-office-startup-trace")).toBe(retained);
    expect(app.window.listenerCount()).toBe(0);

    const initial = fixture(Array.from({ length: 105 }, () => new Frame())); initial.run();
    expect(initial.trace()!.events).toHaveLength(100);
    expect(initial.frames.every(frame => frame.listenerCount() === 0)).toBe(true);
    expect(initial.timers.size).toBe(0);
  });

  it("bounds parent metadata and the event budget, then disconnects while retaining the diagnostic record", () => {
    const app = fixture(); app.run();
    app.parent.setAttribute("data-office-frame-phase", "SECRET_PHASE");
    app.parent.setAttribute("data-office-frame-attempt", "999999999999999999999");
    app.mutate([{ type: "attributes", target: app.parent, attributeName: "data-office-frame-phase", addedNodes: [], removedNodes: [] }]);
    app.parent.setAttribute("data-office-frame-phase", "ready");
    app.parent.setAttribute("data-office-frame-attempt", "1");
    app.mutate([{ type: "attributes", target: app.parent, attributeName: "data-office-frame-phase", addedNodes: [], removedNodes: [] }]);
    expect(JSON.stringify(app.trace())).not.toMatch(/SECRET_PHASE|999999999999999999999/);
    const parents = app.trace()!.events.filter(event => event.kind === "parent");
    expect(parents[0].parent).toEqual({ phase: "unknown", attempt: null });
    expect(parents.at(-1)?.parent).toEqual({ phase: "ready", attempt: 1 });
    app.frames[0].contentDocument.URL = "https://crm.test/private?token=SECRET";
    app.frames[0].contentDocument.readyState = "SECRET";
    app.frames[0].contentDocument.documentElement.setAttribute("data-office-crm", "SECRET");
    app.frames[0].dispatch("load");
    expect(app.trace()!.events.at(-1)).toMatchObject({ document: "other", readyState: "unknown", office: "unknown" });
    expect(JSON.stringify(app.trace())).not.toContain("SECRET");
    for (let n = 0; n < 150; n++) app.window.dispatch("message", { origin: "https://crm.test", source: app.frames[0].contentWindow, data: { type: "aureon-office-ready" } });
    expect(app.trace()!.events.length).toBeLessThanOrEqual(100);
    expect(app.trace()!.stopReason).toBeTruthy();
    expect(app.mutations.every(observer => observer.disconnected)).toBe(true);
    expect(app.resources.every(observer => observer.disconnected)).toBe(true);
    expect(app.window.listenerCount()).toBe(0);

    const deadline = fixture([]); deadline.run(); deadline.advance(119_999);
    expect(deadline.trace()!.stopReason).toBeFalsy();
    deadline.advance(1);
    expect(deadline.trace()!.stopReason).toBeTruthy();
    const retained = deadline.root.getAttribute("data-office-startup-trace");
    expect(retained).not.toBeNull();
    expect(deadline.window.listenerCount()).toBe(0);
    expect(deadline.mutations.every(observer => observer.disconnected)).toBe(true);
    expect(deadline.resources.every(observer => observer.disconnected)).toBe(true);
    expect(deadline.timers.size).toBe(0);
    deadline.advance(60_000);
    expect(deadline.root.getAttribute("data-office-startup-trace")).toBe(retained);
  });
});
