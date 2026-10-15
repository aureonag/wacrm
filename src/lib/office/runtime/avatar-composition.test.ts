import { afterEach, describe, expect, it, vi } from "vitest";

import { createOfficeAvatarComposer, OfficeAvatarError } from "./avatar-composition";

const id = (n: number) => n.toString(16).padStart(36, "0");
const library = (groups = [[id(1), id(2)], [id(3)]]) => ({
  categories: groups.map((ids, i) => ({ id: `category-${i}`, items: [{ variants: ids.map(wearableId => ({ wearableId })) }] })),
});
function png(kind = "essentials", size = 33) {
  const bytes = Buffer.alloc(size);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(kind === "essentials" ? 2304 : 896, 16);
  bytes.writeUInt32BE(kind === "essentials" ? 64 : 320, 20);
  return bytes;
}
const reply = (bytes = png(), init?: ResponseInit) => new Response(Uint8Array.from(bytes), init);
function setup(groups?: string[][]) {
  const loadLibrary = vi.fn(async () => library(groups));
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async url => reply(png(String(url).includes("avatar_extras-") ? "extras" : "essentials")));
  return { loadLibrary, fetchImpl, composer: createOfficeAvatarComposer({ loadLibrary, fetchImpl }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("office avatar composition", () => {
  it.each(["essentials", "extras"])("uses the fixed %s sprite URL/version and disables redirects", async kind => {
    const f = setup(), recipe = `${id(1)}.${id(3)}`;
    const result = await f.composer.load(kind, recipe);
    const prefix = kind === "extras" ? "avatar_extras-" : "avatar-";
    expect(f.fetchImpl).toHaveBeenCalledWith(
      `https://sprite.v2.gather.town/v2/sprite/${prefix}${recipe}.20260929T190313Z.png`,
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal), headers: { Accept: "image/png" } }),
    );
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    expect(result.bytes).toEqual(png(kind));
  });

  it.each([
    ["other", id(1)], [null, id(1)], ["essentials", null], ["essentials", ""],
    ["essentials", "https://example.com/avatar.png"], ["essentials", "../secret"],
    ["essentials", "%30"], ["essentials", ` ${id(1)}`], ["essentials", `${id(1)}.`],
    ["essentials", "a".repeat(407)], ["essentials", Array(12).fill("a").join(".")],
    ["essentials", "a".repeat(37)],
  ])("rejects malformed kinds/recipes before library access (%s %s)", async (kind, recipe) => {
    const f = setup();
    await expect(f.composer.load(kind, recipe)).rejects.toMatchObject({ status: 400 });
    expect(f.loadLibrary).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([id(99), `${id(1)}.${id(1)}`, `${id(1)}.${id(2)}`])("rejects unknown IDs or repeated categories (%s)", async recipe => {
    const f = setup();
    await expect(f.composer.load("essentials", recipe)).rejects.toMatchObject({ status: 400 });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts exactly eleven known categories at the 406-character recipe bound", async () => {
    const groups = Array.from({ length: 11 }, (_, i) => [id(i + 1)]), f = setup(groups);
    const recipe = groups.flat().join(".");
    expect(recipe).toHaveLength(406);
    await expect(f.composer.load("essentials", recipe)).resolves.toHaveProperty("bytes");
  });

  it.each([
    null, {}, { categories: [] }, { categories: [{ id: "x", items: [{}] }] },
    { categories: [{ id: "x", items: [{ variants: [{ wearableId: "https://evil" }] }] }] },
    library([[id(1)], [id(1)]]),
  ])("fails closed for an unusable or ambiguous library (%o)", async data => {
    const fetchImpl = vi.fn<typeof fetch>();
    const composer = createOfficeAvatarComposer({ loadLibrary: async () => data, fetchImpl });
    await expect(composer.load("essentials", id(1))).rejects.toMatchObject({ status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("loads the library once, but permits recovery from a failed initial load", async () => {
    const f = setup();
    f.loadLibrary.mockRejectedValueOnce(new Error("secret source path"));
    await expect(f.composer.load("essentials", id(1))).rejects.toThrow("Office avatar library is unavailable");
    await f.composer.load("essentials", id(1));
    await f.composer.load("extras", id(1));
    expect(f.loadLibrary).toHaveBeenCalledTimes(2);
  });

  it("deduplicates pending work and keeps both shared and cached buffers private", async () => {
    const f = setup(), gate = deferred<Response>();
    f.fetchImpl.mockReturnValueOnce(gate.promise);
    const first = f.composer.load("essentials", id(1));
    const second = f.composer.load("essentials", id(1));
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1));
    gate.resolve(reply());
    const [a, b] = await Promise.all([first, second]);
    a.bytes.fill(0);
    expect(b.bytes).toEqual(png());
    b.bytes.fill(0);
    expect((await f.composer.load("essentials", id(1))).bytes).toEqual(png());
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("limits distinct pending previews to eight while allowing an existing request to join", async () => {
    const f = setup([Array.from({ length: 9 }, (_, i) => id(i + 1))]);
    const gates = Array.from({ length: 8 }, () => deferred<Response>());
    gates.forEach(gate => f.fetchImpl.mockReturnValueOnce(gate.promise));
    const jobs = gates.map((_, i) => f.composer.load("essentials", id(i + 1)));
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(8));
    const joined = f.composer.load("essentials", id(1));
    await expect(f.composer.load("essentials", id(9))).rejects.toMatchObject({ status: 429 });
    gates.forEach(gate => gate.resolve(reply()));
    await Promise.all([...jobs, joined]);
    await f.composer.load("essentials", id(9));
    expect(f.fetchImpl).toHaveBeenCalledTimes(9);
  });

  it("evicts the least recently used sheet at the 32 MiB memory bound", async () => {
    const f = setup([Array.from({ length: 33 }, (_, i) => id(i + 1))]);
    f.fetchImpl.mockImplementation(async () => reply(png("essentials", 1024 * 1024)));
    for (let i = 1; i <= 32; i++) await f.composer.load("essentials", id(i));
    await f.composer.load("essentials", id(1)); // Keep the first item most recent.
    await f.composer.load("essentials", id(33));
    await f.composer.load("essentials", id(1));
    expect(f.fetchImpl).toHaveBeenCalledTimes(33);
    await f.composer.load("essentials", id(2));
    expect(f.fetchImpl).toHaveBeenCalledTimes(34);
  });

  it.each([301, 401, 404, 429, 500])("sanitizes upstream HTTP status %s", async status => {
    const f = setup();
    f.fetchImpl.mockResolvedValueOnce(reply(Buffer.from("upstream secret"), { status }));
    await expect(f.composer.load("essentials", id(1))).rejects.toMatchObject({ status: 502, message: "Office avatar preview could not be loaded" });
  });

  it.each(["redirected", "url"])("rejects unexpected external response %s even if an injected fetch ignores redirect:error", async property => {
    const f = setup(), response = reply();
    Object.defineProperty(response, property, { value: property === "redirected" ? true : "https://example.com/sheet.png" });
    f.fetchImpl.mockResolvedValueOnce(response);
    await expect(f.composer.load("essentials", id(1))).rejects.toMatchObject({ status: 502 });
  });

  it.each(["short", "signature", "ihdr", "width", "height", "wrong-kind"])("rejects an invalid PNG %s", async corruption => {
    const f = setup();
    const bytes = corruption === "short" ? Buffer.alloc(10) : png(corruption === "wrong-kind" ? "extras" : "essentials");
    if (corruption === "signature") bytes[0] = 0;
    if (corruption === "ihdr") bytes.write("FAKE", 12);
    if (corruption === "width") bytes.writeUInt32BE(2303, 16);
    if (corruption === "height") bytes.writeUInt32BE(65, 20);
    f.fetchImpl.mockResolvedValueOnce(reply(bytes));
    await expect(f.composer.load("essentials", id(1))).rejects.toMatchObject({ status: 502 });
  });

  it("rejects an oversized declared body before reading and caps undeclared streaming bytes", async () => {
    const f = setup(), cancel = vi.fn();
    const declaredCancel = vi.fn();
    const declaredBody = new ReadableStream<Uint8Array>({ cancel: declaredCancel });
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(1024 * 1024)); c.enqueue(new Uint8Array(1)); }, cancel });
    f.fetchImpl.mockResolvedValueOnce(new Response(declaredBody, { headers: { "content-length": String(1024 * 1024 + 1) } }));
    await expect(f.composer.load("essentials", id(1))).rejects.toMatchObject({ status: 502 });
    expect(declaredCancel).toHaveBeenCalled();
    f.fetchImpl.mockResolvedValueOnce(new Response(stream));
    await expect(f.composer.load("essentials", id(1))).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalled();
  });

  it("bounds excessive empty chunks as well as byte length", async () => {
    const f = setup(), cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array(0)); }, cancel });
    f.fetchImpl.mockResolvedValueOnce(new Response(stream));
    await expect(f.composer.load("essentials", id(1))).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalled();
  });

  it.each(["fetch", "body"])("enforces the 12-second total deadline for a stalled %s", async stage => {
    vi.useFakeTimers();
    const f = setup(), cancel = vi.fn();
    if (stage === "fetch") f.fetchImpl.mockImplementationOnce(() => new Promise(() => {}));
    else f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel })));
    const request = f.composer.load("essentials", id(1));
    const rejected = expect(request).rejects.toMatchObject({ status: 502 });
    await vi.advanceTimersByTimeAsync(12_000);
    await rejected;
    expect(f.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalled();
    // A failed request must not occupy a pending slot or poison the cache.
    await expect(f.composer.load("essentials", id(1))).resolves.toHaveProperty("bytes");
  });

  it("does not leak thrown fetch/body details and retries failed previews", async () => {
    const f = setup();
    f.fetchImpl.mockRejectedValueOnce(new Error("https://upstream/private?token=secret"));
    try { await f.composer.load("essentials", id(1)); } catch (error) {
      expect(error).toBeInstanceOf(OfficeAvatarError);
      expect(String(error)).not.toContain("token");
      expect(error).not.toHaveProperty("cause");
    }
    f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.error(new Error("secret body")); } })));
    await expect(f.composer.load("essentials", id(1))).rejects.toThrow("Office avatar preview could not be loaded");
    await expect(f.composer.load("essentials", id(1))).resolves.toHaveProperty("bytes");
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
  });
});
