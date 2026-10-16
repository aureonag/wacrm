import { describe, expect, it, vi } from "vitest";

import type { OfficeContext } from "../access";
import { createRequire } from "node:module";
const loadVendorCore = createRequire(import.meta.url);
const vendorCore = loadVendorCore("./vendor/interface-api.cjs") as typeof import("./vendor/interface-api.cjs");
import {
  createCrmInterfaceService,
  OfficeRuntimeError,
  type OfficeRuntimeStore,
  type OfficeSnapshot,
} from "./service.cjs";
import {normalizeOfficeCallConflict, officeCallConflictMessage} from "./call-conflicts.cjs";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function identity(id = USER_A, role: OfficeContext["role"] = "agent", accountId = ACCOUNT_A): OfficeContext {
  const admin = role === "admin" || role === "owner";
  return {
    accountId,
    user: {
      id,
      profileId: "profile-" + id,
      name: id === USER_A ? "Ana CRM" : "Bruno CRM",
      avatarUrl: "https://example.test/crm-photo.png",
    },
    role,
    capabilities: { canDecorate: admin, canManageMembers: admin },
  };
}

function memoryStore() {
  const records = new Map<string, { revision: number; snapshot: OfficeSnapshot | null }>();
  const load = vi.fn(async (accountId: string) =>
    structuredClone(records.get(accountId) ?? { revision: 0, snapshot: null }));
  const compareAndSwap = vi.fn(async (accountId: string, revision: number, snapshot: OfficeSnapshot) => {
    const current = records.get(accountId) ?? { revision: 0, snapshot: null };
    if (current.revision !== revision) return false;
    expect(snapshot.revision).toBe(revision + 1);
    records.set(accountId, { revision: revision + 1, snapshot: structuredClone(snapshot) });
    return true;
  });
  return {
    load,
    compareAndSwap,
    peek: (accountId = ACCOUNT_A) => structuredClone(records.get(accountId)),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function startMeeting(service: ReturnType<typeof createCrmInterfaceService>, privateMeeting = false) {
  await service.requestAsCrm(identity(USER_A), "GET", "/state");
  await service.requestAsCrm(identity(USER_B), "GET", "/state");
  const created = await service.requestAsCrm(identity(USER_A), "POST", "/meetings", {
    name: "Reunião de teste", private: privateMeeting,
  });
  const meetingId = (created.meeting as { id: string }).id;
  await service.requestAsCrm(identity(USER_B), "POST", "/meeting-action", { id: meetingId, action: "join" });
  return meetingId;
}

describe("CRM office runtime", () => {
  it("keeps public call conflict codes allowlisted to 409 and replaces unsafe messages", () => {
    const codes = ["OFFICE_CALL_SESSION_REPLACED", "OFFICE_CALL_SESSION_MISSING", "OFFICE_SIGNAL_RECIPIENT_STALE"];
    for (const code of codes) {
      expect(normalizeOfficeCallConflict(409, code)).toBe(code);
      const error = new OfficeRuntimeError(409, "PRIVATE_TOKEN_OR_SQL", code);
      expect(error.code).toBe(code);
      expect(error.message).toBe(officeCallConflictMessage(code));
      expect(error.message).not.toContain("PRIVATE_TOKEN_OR_SQL");
      for (const status of [400, 401, 403, 404, 429, 500, 503, "409", undefined]) {
        expect(normalizeOfficeCallConflict(status, code)).toBeUndefined();
      }
    }
    const coercion = {toString() { throw Error("Never coerce untrusted metadata"); }};
    for (const code of [undefined, null, "OFFICE_ACCESS_DENIED", "OFFICE_CALL_SESSION_REPLACED_PRIVATE", "__proto__", "toString", coercion]) {
      expect(normalizeOfficeCallConflict(409, code)).toBeUndefined();
      expect(officeCallConflictMessage(code)).toBeUndefined();
      expect(new OfficeRuntimeError(409, "Generic conflict", code)).not.toHaveProperty("code");
    }
    expect(new OfficeRuntimeError(403, "Denied", codes[0])).not.toHaveProperty("code");
  });

  it("requires a real persistence adapter and never falls back to local files or RAM", () => {
    expect(() => createCrmInterfaceService({ store: undefined as unknown as OfficeRuntimeStore }))
      .toThrow(OfficeRuntimeError);
  });

  it("rejects local session creation before loading data and creates no session token", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await expect(service.requestAsCrm(identity(), "POST", "/session", { name: "Invented owner" }))
      .rejects.toMatchObject({ status: 403 });
    expect(store.load).not.toHaveBeenCalled();
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    await expect(service.requestAsCrm(undefined as unknown as OfficeContext, "GET", "/state"))
      .rejects.toMatchObject({ status: 401 });
  });

  it("keeps auth.uid stable across requests/restarts and ignores client identity/role claims", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    const response = await service.requestAsCrm(identity(USER_A, "viewer"), "GET", "/state", {
      name: "Forged", role: "owner", userId: USER_B, accountId: ACCOUNT_B,
      capabilities: { canDecorate: true },
    }, { userId: USER_B, accountId: ACCOUNT_B, role: "owner" });
    expect(response).toMatchObject({
      authentication: "crm",
      user: { id: USER_A, name: "Ana CRM", role: "viewer" },
      capabilities: { canDecorate: false, canManageMembers: false },
    });
    expect(response).not.toHaveProperty("token");
    expect(store.peek()?.snapshot).not.toHaveProperty("sessions");
    const restarted = createCrmInterfaceService({ store });
    const afterRestart = await restarted.requestAsCrm(identity(USER_A, "viewer"), "GET", "/state");
    expect(afterRestart.users).toHaveLength(1);
    expect(afterRestart.user).toMatchObject({ id: USER_A });
    expect(store.load.mock.calls.every(([account]) => account === ACCOUNT_A)).toBe(true);
  });

  it("replaces CRM-controlled name/photo/role while preserving office profile and preferences", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(USER_A, "owner"), "GET", "/state");
    await service.requestAsCrm(identity(USER_A, "owner"), "POST", "/preferences", { volume: 0.4, theme: "dark" });
    const updated = await service.requestAsCrm(identity(USER_A, "viewer"), "POST", "/profile", {
      name: "Forged owner", role: "owner", profilePhotoUrl: "data:untrusted",
      bio: "Bio do escritório", timeZone: "America/Sao_Paulo",
    });
    expect(updated.user).toMatchObject({
      id: USER_A, name: "Ana CRM", role: "viewer",
      profilePhotoUrl: "https://example.test/crm-photo.png",
      bio: "Bio do escritório", timeZone: "America/Sao_Paulo",
      preferences: { volume: 0.4, theme: "dark" },
    });
    const state = await service.requestAsCrm(identity(USER_A, "viewer"), "GET", "/state");
    expect(state.capabilities).toMatchObject({ canDecorate: false, canManageMembers: false });
  });

  it("isolates accounts using only trusted identity", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(USER_A), "POST", "/messages", {
      conversation: "channel:general", text: "Somente conta A",
    });
    const other = identity(USER_B, "agent", ACCOUNT_B);
    const state = await service.requestAsCrm(other, "GET", "/state", {}, { accountId: ACCOUNT_A });
    expect(state.users).toEqual([expect.objectContaining({ id: USER_B })]);
    const messages = await service.requestAsCrm(other, "GET", "/messages", {}, { conversation: "channel:general" });
    expect(messages.messages).toEqual([]);
    expect(store.peek(ACCOUNT_A)?.snapshot?.messages).toHaveLength(1);
  });

  it("does not persist registration or partial mutations from an invalid request", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(USER_A), "GET", "/state");
    const before = store.peek();
    store.compareAndSwap.mockClear();
    await expect(service.requestAsCrm(identity(USER_B), "POST", "/events", {
      title: "Invalid date", start: "bad", end: "bad",
    })).rejects.toMatchObject({ status: 400 });
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    expect(store.peek()).toEqual(before);
    const next = await service.requestAsCrm(identity(USER_A), "GET", "/state");
    expect(next.users).toHaveLength(1);
  });

  it("performs only one CAS for identity plus a successful mutation and returns its committed revision", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(USER_A), "POST", "/messages", {
      conversation: "channel:general", text: "Primeira mensagem",
    });
    expect(store.compareAndSwap).toHaveBeenCalledTimes(1);
    expect(store.peek()?.revision).toBe(1);
    expect(store.peek()?.snapshot?.users).toHaveLength(1);
    const state = await service.requestAsCrm(identity(USER_A), "GET", "/state");
    expect(state.revision).toBe(1);
    expect(store.compareAndSwap).toHaveBeenCalledTimes(1);
  });

  it("does not expose an uncommitted response and queues a following read until CAS finishes", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(), "GET", "/state");
    const gate = deferred();
    const entered = deferred();
    const realCas = store.compareAndSwap.getMockImplementation()!;
    store.compareAndSwap.mockImplementationOnce(async (...args) => {
      entered.resolve();
      await gate.promise;
      return realCas(...args);
    });
    let returned = false;
    const pending = service.requestAsCrm(identity(), "POST", "/messages", {
      conversation: "channel:general", text: "Só após commit",
    }).then(result => { returned = true; return result; });
    await entered.promise;
    const followingRead = service.requestAsCrm(identity(), "GET", "/messages", {}, { conversation: "channel:general" });
    expect(returned).toBe(false);
    expect(store.peek()?.snapshot?.messages).toHaveLength(0);
    gate.resolve();
    await pending;
    expect((await followingRead).messages).toEqual([expect.objectContaining({ text: "Só após commit" })]);
  });

  it("serializes concurrent writes within one instance without losing either message", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(), "GET", "/state");
    await Promise.all(["Uma", "Duas"].map(text => service.requestAsCrm(identity(), "POST", "/messages", {
      conversation: "channel:general", text,
    })));
    expect(store.peek()?.snapshot?.messages).toEqual([
      expect.objectContaining({ text: "Uma", author: USER_A }),
      expect.objectContaining({ text: "Duas", author: USER_A }),
    ]);
  });

  it("rejects stale cross-instance CAS without retrying and allows an explicit fresh retry", async () => {
    const store = memoryStore();
    await createCrmInterfaceService({ store }).requestAsCrm(identity(), "GET", "/state");
    const realLoad = store.load.getMockImplementation()!;
    const bothLoaded = deferred();
    let waiting = 0;
    store.load.mockImplementation(async accountId => {
      const record = await realLoad(accountId);
      if (++waiting === 2) bothLoaded.resolve();
      await bothLoaded.promise;
      return record;
    });
    const instances = [createCrmInterfaceService({ store }), createCrmInterfaceService({ store })];
    const results = await Promise.allSettled(instances.map((service, i) =>
      service.requestAsCrm(identity(), "POST", "/messages", { conversation: "channel:general", text: "Mensagem " + i })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const loser = results.findIndex(result => result.status === "rejected");
    expect(results[loser]).toMatchObject({ status: "rejected", reason: { status: 409 } });
    const rejected = results[loser];
    if (rejected.status === "rejected") expect(rejected.reason).not.toHaveProperty("code");
    expect(store.peek()?.snapshot?.messages).toHaveLength(1);
    store.load.mockImplementation(realLoad);
    await instances[loser].requestAsCrm(identity(), "POST", "/messages", {
      conversation: "channel:general", text: "Mensagem " + loser,
    });
    expect(store.peek()?.snapshot?.messages).toHaveLength(2);
  });

  it("discards durable and volatile mutations when persistence fails", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    const meeting = await startMeeting(service);
    const a = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", { meeting });
    await service.requestAsCrm(identity(USER_B), "POST", "/call-session", { meeting });
    await service.requestAsCrm(identity(USER_A), "POST", "/spatial-presence", { x: 224, y: 368 });
    const before = store.peek();
    ++time;
    store.compareAndSwap.mockRejectedValueOnce(new Error("private database detail"));
    await expect(service.requestAsCrm(identity(USER_A), "POST", "/presence", { status: "offline" }))
      .rejects.toMatchObject({ status: 503 });
    expect(store.peek()).toEqual(before);
    // An uncertain CAS invalidates transport as well as the durable cache: the
    // adapter may have committed despite its error, so old calls cannot survive.
    await expect(service.requestAsCrm(identity(USER_A), "GET", "/signals", {}, { meeting, call: a.callId }))
      .rejects.toMatchObject({ status: 409, code: "OFFICE_CALL_SESSION_MISSING" });
    expect((await service.requestAsCrm(identity(USER_A), "GET", "/spatial-state")).users).toEqual([]);
  });

  it("persists chat/settings but resets presence leases and calls on restart", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    const meeting = await startMeeting(service);
    const call = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", { meeting });
    await service.requestAsCrm(identity(USER_A), "POST", "/spatial-presence", {
      x: 224, y: 368, instanceId: "tab-test-123", expectedVersion: 0, takeControl: true,
    });
    await service.requestAsCrm(identity(USER_A), "POST", "/preferences", { volume: 0.25 });
    await service.requestAsCrm(identity(USER_A), "POST", "/messages", { conversation: "channel:general", text: "Persistida" });
    const restarted = createCrmInterfaceService({ store });
    expect((await restarted.requestAsCrm(identity(USER_A), "GET", "/state")).user)
      .toMatchObject({ id: USER_A, preferences: { volume: 0.25 } });
    expect((await restarted.requestAsCrm(identity(USER_A), "GET", "/messages", {}, { conversation: "channel:general" })).messages)
      .toEqual([expect.objectContaining({ text: "Persistida", author: USER_A })]);
    expect((await restarted.requestAsCrm(identity(USER_A), "GET", "/spatial-state")).users).toEqual([]);
    await expect(restarted.requestAsCrm(identity(USER_A), "GET", "/signals", {}, { meeting, call: call.callId }))
      .rejects.toMatchObject({ status: 409, code: "OFFICE_CALL_SESSION_MISSING" });
  });

  it("classifies the replaced caller before a stale recipient without exposing either current call token", async () => {
    const service = createCrmInterfaceService({store: memoryStore()});
    const meeting = await startMeeting(service);
    const old = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", {meeting});
    const peer = await service.requestAsCrm(identity(USER_B), "POST", "/call-session", {meeting});
    const current = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", {meeting});
    expect(current.callId).not.toBe(old.callId);
    for (const operation of [
      service.requestAsCrm(identity(USER_A), "GET", "/signals", {}, {meeting, call: old.callId}),
      service.requestAsCrm(identity(USER_A), "POST", "/signal", {
        meeting, call: old.callId, to: USER_B, toCall: "stale-recipient", signal: {type: "renegotiate"},
      }),
    ]) {
      const error = await operation.catch(error => error);
      expect(error).toMatchObject({status: 409, code: "OFFICE_CALL_SESSION_REPLACED"});
      expect(error.message).toBe(officeCallConflictMessage(error.code));
      expect(JSON.stringify(error)).not.toContain(current.callId);
      expect(JSON.stringify(error)).not.toContain(peer.callId);
    }
    const signals = await service.requestAsCrm(identity(USER_A), "GET", "/signals", {}, {meeting, call: current.callId});
    expect(signals.roster).toMatchObject({[USER_A]: current.callId, [USER_B]: peer.callId});
  });

  it("distinguishes absent own sessions from absent or replaced peers and keeps the valid caller usable", async () => {
    const service = createCrmInterfaceService({store: memoryStore()});
    const meeting = await startMeeting(service);
    await expect(service.requestAsCrm(identity(USER_A), "GET", "/signals", {}, {meeting, call: "missing-own"}))
      .rejects.toMatchObject({status: 409, code: "OFFICE_CALL_SESSION_MISSING"});
    await expect(service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: "missing-own", to: USER_B, toCall: "also-missing", signal: {type: "renegotiate"},
    })).rejects.toMatchObject({status: 409, code: "OFFICE_CALL_SESSION_MISSING"});
    const caller = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", {meeting});
    await expect(service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: caller.callId, to: USER_B, toCall: "missing-peer", signal: {type: "renegotiate"},
    })).rejects.toMatchObject({status: 409, code: "OFFICE_SIGNAL_RECIPIENT_STALE"});
    const oldPeer = await service.requestAsCrm(identity(USER_B), "POST", "/call-session", {meeting});
    const peer = await service.requestAsCrm(identity(USER_B), "POST", "/call-session", {meeting});
    await expect(service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: caller.callId, to: USER_B, toCall: oldPeer.callId, signal: {type: "renegotiate"},
    })).rejects.toMatchObject({status: 409, code: "OFFICE_SIGNAL_RECIPIENT_STALE"});
    await expect(service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: caller.callId, to: USER_B, toCall: peer.callId, signal: {type: "renegotiate"},
    })).resolves.toMatchObject({ok: true});
    const incoming = await service.requestAsCrm(identity(USER_B), "GET", "/signals", {}, {meeting, call: peer.callId});
    expect(incoming.signals).toEqual([expect.objectContaining({from: USER_A, to: USER_B})]);
  });

  it("retains offline and meeting membership denial before call conflict classification", async () => {
    const service = createCrmInterfaceService({store: memoryStore()});
    const meeting = await startMeeting(service);
    const call = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", {meeting});
    const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const denied = [
      service.requestAsCrm(identity(third), "GET", "/signals", {}, {meeting, call: "mismatch"}),
      service.requestAsCrm(identity(third), "POST", "/signal", {
        meeting, call: "mismatch", to: USER_B, toCall: "mismatch", signal: {type: "renegotiate"},
      }),
    ];
    for (const operation of denied) {
      const error = await operation.catch(error => error);
      expect(error.status).toBe(403); expect(error).not.toHaveProperty("code");
    }
    await service.requestAsCrm(identity(USER_B), "POST", "/presence", {status: "offline"});
    const offlinePeer = await service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: "stale-own", to: USER_B, toCall: "stale-peer", signal: {type: "renegotiate"},
    }).catch(error => error);
    expect(offlinePeer.status).toBe(403); expect(offlinePeer).not.toHaveProperty("code");
    await service.requestAsCrm(identity(USER_A), "POST", "/presence", {status: "offline"});
    const offlineSelf = await service.requestAsCrm(identity(USER_A), "GET", "/signals", {}, {meeting, call: call.callId}).catch(error => error);
    expect(offlineSelf.status).toBe(403); expect(offlineSelf).not.toHaveProperty("code");
  });

  it("shares leased position and signaling between identities in the same instance with real TTLs", async () => {
    let time = 200_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    const meeting = await startMeeting(service);
    const a = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", { meeting });
    const b = await service.requestAsCrm(identity(USER_B), "POST", "/call-session", { meeting });
    await service.requestAsCrm(identity(USER_A), "POST", "/spatial-presence", {
      x: 224, y: 368, instanceId: "tab-first-123", expectedVersion: 0, takeControl: true,
    });
    const spatialConflict = service.requestAsCrm(identity(USER_A), "POST", "/spatial-presence", {
      x: 250, y: 380, instanceId: "tab-second-123", expectedVersion: 1,
    });
    await expect(spatialConflict).rejects.toMatchObject({ status: 409 });
    await expect(spatialConflict).rejects.not.toHaveProperty("code");
    await service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: a.callId, to: USER_B, toCall: b.callId,
      signal: { type: "offer", sdp: "fake-sdp-for-state-test" },
    });
    const received = await service.requestAsCrm(identity(USER_B), "GET", "/signals", {}, { meeting, call: b.callId, after: 0 });
    expect(received.signals).toEqual([expect.objectContaining({ from: USER_A, to: USER_B, signal: { type: "offer", sdp: "fake-sdp-for-state-test" } })]);
    time += 21_000;
    expect((await service.requestAsCrm(identity(USER_B), "GET", "/spatial-state")).users).toEqual([]);
  });

  it("preserves private meeting approval and private chat permissions with CRM IDs", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    const meeting = await startMeeting(service, true);
    await expect(service.requestAsCrm(identity(USER_B), "GET", "/messages", {}, { conversation: "meeting:" + meeting }))
      .rejects.toMatchObject({ status: 403 });
    await service.requestAsCrm(identity(USER_A), "POST", "/meeting-action", {
      id: meeting, action: "approve", userId: USER_B,
    });
    await service.requestAsCrm(identity(USER_B), "POST", "/messages", { conversation: "meeting:" + meeting, text: "Privada" });
    expect((await service.requestAsCrm(identity(USER_A), "GET", "/messages", {}, { conversation: "meeting:" + meeting })).messages)
      .toEqual([expect.objectContaining({ author: USER_B, recipients: [USER_A, USER_B], text: "Privada" })]);
    const third = identity("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    await expect(service.requestAsCrm(third, "GET", "/messages", {}, { conversation: "meeting:" + meeting }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("fails closed on unavailable or corrupt storage without leaking raw details", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    store.load.mockRejectedValueOnce(new Error("secret connection string"));
    await expect(service.requestAsCrm(identity(), "GET", "/state"))
      .rejects.toMatchObject({ status: 503, message: "O escritório está indisponível. Tente novamente." });
    store.load.mockResolvedValueOnce({ revision: 1, snapshot: { version: 999 } });
    await expect(service.requestAsCrm(identity(), "GET", "/state")).rejects.toMatchObject({ status: 503 });
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });
});

describe("CRM map bootstrap and private client state", () => {
  const mapSeed = { objects: [{ id: "approved-desk", type: "desk", x: 224, y: 400 }], floor: "#a27f6b" };

  it("seeds the approved map once and never accepts map edits through user requests", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: mapSeed });
    const bootstrap = await service.requestAsCrm(identity(), "GET", "/bootstrap");
    expect(bootstrap).toEqual({ map: mapSeed, clientState: {} });
    expect(store.peek()?.snapshot?.officeMap).toEqual(mapSeed);
    (bootstrap.map as typeof mapSeed).objects[0].x = 9999;
    await expect(service.requestAsCrm(identity(USER_A, "owner"), "POST", "/bootstrap", {
      map: { objects: [], floor: "#ffffff" },
    })).rejects.toMatchObject({ status: 404 });
    const nextSeed = { objects: [], floor: "#ffffff" };
    const restarted = createCrmInterfaceService({ store, approvedMap: nextSeed });
    expect((await restarted.requestAsCrm(identity(), "GET", "/bootstrap")).map).toEqual(mapSeed);
    expect(store.peek()?.snapshot?.officeMap).toEqual(mapSeed);
  });

  it("copies the constructor seed and preserves the complete approved 122-object map", async () => {
    const { default: approved } = await import("./seeds/approved-map.json");
    const source = structuredClone(approved.map);
    expect(source.objects).toHaveLength(122);
    expect(source.construction).toHaveLength(296);
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: source });
    source.objects.pop();
    expect((await service.requestAsCrm(identity(), "GET", "/bootstrap")).map).toEqual(approved.map);
    expect(store.peek()?.snapshot?.officeMap).toEqual(approved.map);
  });

  it("returns client state only for the trusted user and account across restarts", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: mapSeed });
    const entries = {
      "aureon-avatar-v1": JSON.stringify({ hair: "approved-hair" }),
      "aureon-camera-device": "camera-ana",
      "aureon-window-frame-v1": "#aabbcc",
    };
    expect(await service.requestAsCrm(identity(USER_A), "POST", "/client-state", { entries }))
      .toEqual({ clientState: entries });
    expect(await service.requestAsCrm(identity(USER_B), "GET", "/client-state", {}, {
      userId: USER_A, accountId: ACCOUNT_A,
    })).toEqual({ clientState: {} });
    expect((await service.requestAsCrm(identity(USER_B), "GET", "/bootstrap", {}, { userId: USER_A })).clientState)
      .toEqual({});
    const otherAccount = identity(USER_A, "agent", ACCOUNT_B);
    expect(await service.requestAsCrm(otherAccount, "GET", "/client-state")).toEqual({ clientState: {} });
    const restarted = createCrmInterfaceService({ store, approvedMap: mapSeed });
    expect((await restarted.requestAsCrm(identity(USER_A), "GET", "/bootstrap")).clientState).toEqual(entries);
    const publicState = await restarted.requestAsCrm(identity(USER_B), "GET", "/state");
    expect(JSON.stringify(publicState)).not.toMatch(/approved-hair|camera-ana|officeMap|officeClientState/);
  });

  it("patches allowed keys, removes null entries and leaves other users unchanged", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: mapSeed });
    await service.requestAsCrm(identity(USER_A), "POST", "/client-state", {
      entries: { "aureon-camera-device": "camera-a", "aureon-microphone-device": "mic-a" },
    });
    await service.requestAsCrm(identity(USER_B), "POST", "/client-state", {
      entries: { "aureon-camera-device": "camera-b" },
    });
    const patched = await service.requestAsCrm(identity(USER_A), "POST", "/client-state", {
      entries: { "aureon-camera-device": null, "aureon-avatar-v1": "{}" },
    });
    expect(patched).toEqual({ clientState: { "aureon-microphone-device": "mic-a", "aureon-avatar-v1": "{}" } });
    expect(await service.requestAsCrm(identity(USER_B), "GET", "/client-state"))
      .toEqual({ clientState: { "aureon-camera-device": "camera-b" } });
  });

  it.each([
    { "aureon-interface-session": "token" },
    { "aureon-interface-session-v1": "token" },
    { "sb-project-auth-token": "token" },
    { accountId: ACCOUNT_B },
    { "aurion-office-v1": "{}" },
    { "aureon-camera-device": "x", "unapproved-key": "value" },
  ])("rejects non-whitelisted or auth/map state atomically (%s)", async entries => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: mapSeed });
    await service.requestAsCrm(identity(), "GET", "/bootstrap");
    const before = store.peek();
    store.compareAndSwap.mockClear();
    await expect(service.requestAsCrm(identity(), "POST", "/client-state", { entries }))
      .rejects.toMatchObject({ status: 400 });
    expect(store.peek()).toEqual(before);
    expect(store.compareAndSwap).not.toHaveBeenCalled();
  });

  it.each([
    { "aureon-avatar-v1": "[]" },
    { "aureon-gather-avatar-plan-v1": "null" },
    { "aureon-gather-avatar-applied-v1": "invalid json" },
    { "aureon-reactions-v1": "true" },
    { "aureon-soundboard-v1": "[]" },
    { "aureon-window-frame-v1": "red" },
    { "aureon-camera-device": 42 },
    { "aureon-microphone-device": "é".repeat(513) },
    { "aureon-avatar-v1": JSON.stringify({ text: "é".repeat(16384) }) },
  ])("enforces value shapes and UTF-8 byte limits (%s)", async entries => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: mapSeed });
    await expect(service.requestAsCrm(identity(), "POST", "/client-state", { entries }))
      .rejects.toMatchObject({ status: 400 });
    expect(store.peek()).toBeUndefined();
  });

  it("rejects forged target-user fields and oversized patch counts", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await expect(service.requestAsCrm(identity(), "POST", "/client-state", {
      entries: { "aureon-camera-device": "camera" }, userId: USER_B,
    })).rejects.toMatchObject({ status: 400 });
    const entries = Object.fromEntries(Array.from({ length: 9 }, (_, i) => ["key-" + i, null]));
    await expect(service.requestAsCrm(identity(), "POST", "/client-state", { entries }))
      .rejects.toMatchObject({ status: 400 });
  });

  it("returns neither seeded map nor state after a failed first CAS", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, approvedMap: mapSeed });
    store.compareAndSwap.mockResolvedValueOnce(false);
    await expect(service.requestAsCrm(identity(), "POST", "/client-state", {
      entries: { "aureon-avatar-v1": "{}" },
    })).rejects.toBeInstanceOf(OfficeRuntimeError);
    expect(store.peek()).toBeUndefined();
    expect(await service.requestAsCrm(identity(), "GET", "/bootstrap")).toEqual({ map: mapSeed, clientState: {} });
  });

  it("normalizes controlled vendor failures and fails closed without an approved map", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await expect(service.requestAsCrm(identity(), "GET", "/bootstrap"))
      .rejects.toMatchObject({ name: "OfficeRuntimeError", status: 503 });
    await expect(service.requestAsCrm(identity(), "POST", "/presence", { status: "forged" }))
      .rejects.toMatchObject({ name: "OfficeRuntimeError", status: 400 });
    expect(store.peek()).toBeUndefined();
  });
});

describe("bootstrap account isolation and safe errors", () => {
  it("never selects another account's map from request fields", async () => {
    const store = memoryStore();
    const mapA = { objects: [{ id: "account-a-only" }], floor: "#111111" };
    const mapB = { objects: [{ id: "account-b-only" }], floor: "#222222" };
    const serviceA = createCrmInterfaceService({ store, approvedMap: mapA });
    const serviceB = createCrmInterfaceService({ store, approvedMap: mapB });
    await serviceA.requestAsCrm(identity(USER_A, "agent", ACCOUNT_A), "GET", "/bootstrap");
    await serviceB.requestAsCrm(identity(USER_B, "agent", ACCOUNT_B), "GET", "/bootstrap");
    expect((await serviceA.requestAsCrm(identity(USER_A, "agent", ACCOUNT_A), "GET", "/bootstrap",
      { accountId: ACCOUNT_B }, { accountId: ACCOUNT_B })).map).toEqual(mapA);
    expect((await serviceB.requestAsCrm(identity(USER_B, "agent", ACCOUNT_B), "GET", "/bootstrap",
      { accountId: ACCOUNT_A }, { accountId: ACCOUNT_A })).map).toEqual(mapB);
  });

  it("normalizes unexpected core errors without exposing their cause", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(), "GET", "/state");
    const malformed = store.peek()!;
    malformed.snapshot!.users = [null];
    store.load.mockResolvedValueOnce(malformed);
    await expect(service.requestAsCrm(identity(), "GET", "/state")).rejects.toMatchObject({
      name: "OfficeRuntimeError", status: 500, message: "Não foi possível concluir esta operação.",
    });
  });
});

describe("readonly construction", () => {
  it("preserves construction extras without recomposing walls or changing transforms", async () => {
    const store = memoryStore();
    const map = {
      objects: [{ id: "desk", x: 224, y: 400 }], floor: "#a27f6b",
      construction: [{
        id: "wall-1", type: "wall", a: { x: 10, y: 20 }, b: { x: 50, y: 20 },
        width: 4, cut: { side: "left" }, brandLogo: { path: "approved-logo.png" }, futureProperty: [1, "keep"],
      }],
    };
    const service = createCrmInterfaceService({ store, approvedMap: map });
    expect((await service.requestAsCrm(identity(), "GET", "/bootstrap")).map).toEqual(map);
    expect(store.peek()?.snapshot?.officeMap).toEqual(map);
  });

  it.each([
    "not-json-construction", null, new Array(5001).fill({}),
    { label: "x".repeat(512 * 1024) },
  ])("rejects malformed or oversized construction (%s)", construction => {
    const store = memoryStore();
    expect(() => createCrmInterfaceService({
      store, approvedMap: { objects: [], floor: "#a27f6b", construction },
    })).toThrow(OfficeRuntimeError);
    expect(store.load).not.toHaveBeenCalled();
  });
});

describe("client/server persistence contract", () => {
  it("keeps the public bootstrap whitelist identical to the private backend", async () => {
    const backend = await import("./client-state.cjs");
    const client = await import("../../../../scripts/office-crm-bootstrap.mjs");
    expect(backend.CLIENT_STATE_LIMITS).toEqual(client.CLIENT_STATE_LIMITS);
    expect([...backend.CLIENT_STATE_KEYS].sort()).toEqual([...client.CLIENT_STATE_KEYS].sort());
    expect(backend.CLIENT_STATE_KEYS).toHaveLength(8);
  });
});

describe("spatial committed-snapshot fast path", () => {
  it("runs 20 warm spatial publishes plus state/control with zero DB calls", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    const committed = store.peek();
    store.load.mockClear(); store.compareAndSwap.mockClear();
    let version = 0;
    for (let i = 0; i < 20; i++) {
      ++time;
      const result = await service.requestAsCrm(identity(), "POST", "/spatial-presence", {
        x: 224 + i, y: 368, instanceId: "moving-tab-123", expectedVersion: version, takeControl: i === 0,
      });
      version = (result.control as { version: number }).version;
    }
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-control")).active).toBe(true);
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users)
      .toEqual([expect.objectContaining({ id: USER_A, spatialPosition: expect.objectContaining({ x: 243, y: 368 }) })]);
    expect(store.load).not.toHaveBeenCalled();
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    expect(store.peek()).toEqual(committed);
  });

  it("uses lastSeen overlay for visibility/TTL and coalesces it on a same-time heartbeat", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    time = 200_000;
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    store.load.mockClear(); store.compareAndSwap.mockClear();
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users).toHaveLength(1);
    expect((store.peek()?.snapshot?.users as Array<{ lastSeen: number }>)[0].lastSeen).toBe(100_000);
    expect(store.load).not.toHaveBeenCalled();
    await service.requestAsCrm(identity(), "POST", "/heartbeat");
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.compareAndSwap).toHaveBeenCalledTimes(1);
    expect((store.peek()?.snapshot?.users as Array<{ lastSeen: number }>)[0].lastSeen).toBe(200_000);
    time += 21_000;
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users).toEqual([]);
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it("uses one durable operation for a cold or changed CRM profile and then warms it", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    const changed = identity(USER_A, "viewer");
    changed.user.name = "Ana atualizada"; changed.user.profileId = "new-profile";
    changed.user.avatarUrl = "https://example.test/new-photo.png";
    store.load.mockClear(); store.compareAndSwap.mockClear();
    ++time;
    const result = await service.requestAsCrm(changed, "POST", "/spatial-presence", {
      x: 224, y: 368, instanceId: "changed-tab-123", expectedVersion: 0, takeControl: true,
    });
    expect(result.control).toMatchObject({ version: 1 });
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.compareAndSwap).toHaveBeenCalledTimes(1);
    expect((store.peek()?.snapshot?.users as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: USER_A, name: "Ana atualizada", profileId: "new-profile", role: "viewer",
      profilePhotoUrl: "https://example.test/new-photo.png",
    });
    await service.requestAsCrm(changed, "GET", "/spatial-state");
    expect(store.load).toHaveBeenCalledTimes(1);
    const second = await service.requestAsCrm(identity(USER_B), "POST", "/spatial-presence", { x: 300, y: 368 });
    expect(second.position).toMatchObject({ x: 300 });
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(store.compareAndSwap).toHaveBeenCalledTimes(2);
  });

  it("serializes chosen offline status before a queued spatial operation", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    await service.requestAsCrm(identity(), "GET", "/state");
    const entered = deferred(), release = deferred();
    const original = store.compareAndSwap.getMockImplementation()!;
    store.compareAndSwap.mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; return original(...args);
    });
    const offline = service.requestAsCrm(identity(), "POST", "/presence", { status: "offline" });
    await entered.promise;
    const spatial = service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    release.resolve(); await offline;
    await expect(spatial).rejects.toMatchObject({ status: 403 });
    expect((store.peek()?.snapshot?.users as Array<{ status: string }>)[0].status).toBe("offline");
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users).toEqual([]);
  });

  it("rolls back failed spatial work and does not advance the activity overlay", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    time = 200_000;
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    time = 201_000;
    await expect(service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 999999, y: 368 }))
      .rejects.toMatchObject({ status: 400 });
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users)
      .toEqual([expect.objectContaining({ spatialPosition: expect.objectContaining({ x: 224, updatedAt: 200_000 }) })]);
    const state = await service.requestAsCrm(identity(), "GET", "/state");
    expect(state.user).toMatchObject({ lastSeen: 200_000, status: "online" });
    expect((store.peek()?.snapshot?.users as Array<{ lastSeen: number }>)[0].lastSeen).toBe(200_000);
  });

  it("drops overlay and transport state after observing an external durable revision", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    time = 200_000;
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    const external = store.peek()!;
    (external.snapshot!.users as Array<Record<string, unknown>>)[0].status = "offline";
    (external.snapshot!.users as Array<Record<string, unknown>>)[0].lastSeen = 1234;
    external.snapshot!.revision = external.revision + 1;
    await store.compareAndSwap(ACCOUNT_A, external.revision, external.snapshot!);
    expect((await service.requestAsCrm(identity(), "GET", "/state")).user)
      .toMatchObject({ status: "offline", lastSeen: 1234 });
    store.load.mockClear(); store.compareAndSwap.mockClear();
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users).toEqual([]);
    await expect(service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 230, y: 368 }))
      .rejects.toMatchObject({ status: 403 });
    expect(store.load).not.toHaveBeenCalled();
  });

  it("invalidates the slot after false CAS and never replays the failed operation", async () => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    time = 200_000;
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    store.compareAndSwap.mockResolvedValueOnce(false);
    await expect(service.requestAsCrm(identity(), "POST", "/presence", { status: "offline" }))
      .rejects.toMatchObject({ status: 409 });
    store.load.mockClear(); store.compareAndSwap.mockClear();
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users).toEqual([]);
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    expect((store.peek()?.snapshot?.users as Array<{ lastSeen: number; status: string }>)[0])
      .toMatchObject({ lastSeen: 100_000, status: "online" });
  });

  it.each(["throw", "invalid-result"] as const)("invalidates the slot after commit then %s, without retrying", async mode => {
    let time = 100_000;
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => time });
    await service.requestAsCrm(identity(), "GET", "/state");
    time = 200_000;
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    const realCas = store.compareAndSwap.getMockImplementation()!;
    store.compareAndSwap.mockClear();
    store.compareAndSwap.mockImplementationOnce(async (...args) => {
      expect(await realCas(...args)).toBe(true);
      if (mode === "throw") throw new Error("response lost after commit");
      return undefined as unknown as boolean;
    });
    await expect(service.requestAsCrm(identity(), "POST", "/presence", { status: "offline" }))
      .rejects.toMatchObject({ status: 503, message: "O escritório está indisponível. Tente novamente." });
    expect(store.compareAndSwap).toHaveBeenCalledTimes(1);
    expect((store.peek()?.snapshot?.users as Array<{ status: string }>)[0].status).toBe("offline");
    store.load.mockClear(); store.compareAndSwap.mockClear();
    await expect(service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 230, y: 368 }))
      .rejects.toMatchObject({ status: 403 });
    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.compareAndSwap).not.toHaveBeenCalled();
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users).toEqual([]);
  });

  it("keeps calls/signals/heartbeat and other non-spatial operations on fresh storage", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    const meeting = await startMeeting(service);
    const a = await service.requestAsCrm(identity(USER_A), "POST", "/call-session", { meeting });
    const b = await service.requestAsCrm(identity(USER_B), "POST", "/call-session", { meeting });
    store.load.mockClear();
    await service.requestAsCrm(identity(USER_A), "GET", "/signals", {}, { meeting, call: a.callId });
    await service.requestAsCrm(identity(USER_A), "POST", "/signal", {
      meeting, call: a.callId, to: USER_B, toCall: b.callId, signal: { type: "offer", sdp: "test" },
    });
    await service.requestAsCrm(identity(USER_A), "POST", "/heartbeat");
    await service.requestAsCrm(identity(USER_A), "GET", "/messages", {}, { conversation: "channel:general" });
    await service.requestAsCrm(identity(USER_A), "POST", "/preferences", { volume: 0.5 });
    expect(store.load).toHaveBeenCalledTimes(5);
  });

  it("caps each FIFO at 128 including the active job, before cloning, then releases all reservations", async () => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store });
    const release = deferred(), entered = deferred(), originalLoad = store.load.getMockImplementation()!;
    store.load.mockImplementationOnce(async accountId => {
      entered.resolve(); await release.promise; return originalLoad(accountId);
    });
    const first = service.requestAsCrm(identity(), "GET", "/state");
    await entered.promise;
    const queued = Array.from({ length: 127 }, () => service.requestAsCrm(identity(), "GET", "/spatial-control"));
    let cloned = false;
    const body = { y: 368, get x() { cloned = true; return 224; } };
    await expect(service.requestAsCrm(identity(), "POST", "/spatial-presence", body))
      .rejects.toMatchObject({ status: 429 });
    expect(cloned).toBe(false);
    release.resolve();
    await Promise.all([first, ...queued]);
    await expect(service.requestAsCrm(identity(), "POST", "/spatial-presence", [] as unknown as Record<string, unknown>))
      .rejects.toMatchObject({ status: 400 });
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", body);
    expect(cloned).toBe(true);
    expect(store.load).toHaveBeenCalledTimes(1);
  });
});

describe("spatial guard against future durable mutations", () => {
  it.each(["status", "dirty", "constructor"] as const)("rejects %s without DB fallback or exposing working state", async mode => {
    const store = memoryStore();
    const service = createCrmInterfaceService({ store, now: () => 100_000 });
    await service.requestAsCrm(identity(), "GET", "/state");
    await service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 224, y: 368 });
    const committed = store.peek();
    store.load.mockClear(); store.compareAndSwap.mockClear();
    const original = vendorCore.createInterfaceService;
    const fault = vi.spyOn(vendorCore, "createInterfaceService").mockImplementation(options => {
      const core = original(options);
      let executed = false;
      return {
        ...core,
        async requestAsCrm(...args: Parameters<typeof core.requestAsCrm>) {
          const result = await core.requestAsCrm(...args);
          executed = true;
          return result;
        },
        snapshot() {
          const next = core.snapshot();
          if (executed && mode === "status" || mode === "constructor") {
            (next.users as Array<Record<string, unknown>>)[0].status = "offline";
          }
          return next;
        },
        isDirty() { return core.isDirty() || mode === "dirty" && executed; },
      };
    });
    try {
      await expect(service.requestAsCrm(identity(), "POST", "/spatial-presence", { x: 300, y: 368 }))
        .rejects.toMatchObject({ status: 500 });
      expect(fault).toHaveBeenCalledTimes(1);
      expect(store.load).not.toHaveBeenCalled();
      expect(store.compareAndSwap).not.toHaveBeenCalled();
      expect(store.peek()).toEqual(committed);
    } finally {
      fault.mockRestore();
    }
    expect((await service.requestAsCrm(identity(), "GET", "/spatial-state")).users)
      .toEqual([expect.objectContaining({ status: "online", spatialPosition: expect.objectContaining({ x: 224 }) })]);
    expect(store.load).not.toHaveBeenCalled();
  });
});
