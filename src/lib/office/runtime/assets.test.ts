import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOfficeAssetLoader, OfficeAssetError } from "./assets";

const roots: string[] = [];
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function fixture(files: Record<string, string> = { "index.html": "<p>Office</p>" }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-assets-test-"));
  roots.push(directory);
  const records = [];
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text);
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await fs.writeFile(path.join(directory, name), bytes);
    records.push({ path: name, bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = { version: 1, mode: "written", fileCount: records.length, files: records };
  const save = async (data: unknown = manifest) => fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(data));
  await save();
  return { directory, manifest, save, loader: createOfficeAssetLoader({ directory }) };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    // Only remove directories this fixture created within the resolved OS temp root.
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    if (path.isAbsolute(relative) || relative.startsWith("..") ||
      !path.basename(root).startsWith("office-assets-test-")) throw new Error("Unsafe fixture cleanup");
    await fs.rm(root, { recursive: true, force: true });
  }
});

describe("private office asset loader", () => {
  it("requires both CRM bootstrap markers only when explicitly enabled", async () => {
    const f = await fixture();
    const loader = createOfficeAssetLoader({ directory: f.directory, requireCrmBootstrap: true });
    await expect(loader.load("index.html")).rejects.toMatchObject({ status: 503 });
    await f.save({ ...f.manifest, crmBootstrapVersion: 1 });
    await expect(loader.load("index.html")).rejects.toMatchObject({ status: 503 });
    await f.save({ ...f.manifest, crmBootstrapVersion: 1, crmSessionRequired: true });
    expect((await loader.load("index.html")).bytes.toString()).toBe("<p>Office</p>");
  });

  it("returns only allowlisted, verified bytes with a fixed MIME and ETag", async () => {
    const f = await fixture({ "index.html": "<p>Office</p>", "assets/chair.png": "fixture image" });
    const asset = await f.loader.load("assets/chair.png");
    expect(Buffer.isBuffer(asset.bytes)).toBe(true);
    expect(asset.bytes.toString()).toBe("fixture image");
    expect(asset.contentType).toBe("image/png");
    expect(asset.size).toBe(13);
    expect(asset.etag).toBe(`"${sha(asset.bytes)}"`);
  });

  it("does not serve an unlisted physical file or the packaging manifest", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, "extra.js"), "not in the allowlist");
    for (const name of ["extra.js", "manifest.json", "MANIFEST.JSON"]) {
      await expect(f.loader.load(name)).rejects.toMatchObject({ status: 404 });
    }
  });

  it("permits a reviewed native avatar JSON dependency without serving the packaging manifest", async () => {
    const f = await fixture({ "assets/gather/avatar/native-library-manifest.json": "{}" });
    expect((await f.loader.load("assets/gather/avatar/native-library-manifest.json")).contentType)
      .toBe("application/json; charset=utf-8");
  });

  it.each([
    "", "/index.html", "//server/index.html", "../index.html", "assets/../index.html",
    "assets//chair.png", "assets/./chair.png", "assets/", "assets/.env", ".git/config",
    ".aureon-local/state.json", "assets/%2e%2e/index.html", "%252e%252e/index.html",
    "assets%2fchair.png", "assets\\chair.png", "C:/secret.png", "index.html:stream",
    "index.html?x=1", "index.html#x", "assets/CON.png", "assets/nul", "index.html\0",
  ])("rejects unsafe raw paths without decoding them (%s)", async name => {
    const f = await fixture();
    await expect(f.loader.load(name)).rejects.toMatchObject({ status: 404 });
  });

  it("reads only the requested asset, not the entire library", async () => {
    const f = await fixture({ "index.html": "valid", "assets/other.png": "not requested" });
    f.manifest.files[1].sha256 = "0".repeat(64);
    await f.save();
    expect((await f.loader.load("index.html")).bytes.toString()).toBe("valid");
    await expect(f.loader.load("assets/other.png")).rejects.toMatchObject({ status: 503 });
  });

  it("caches the manifest parse while its file identity/timestamps stay unchanged", async () => {
    const f = await fixture();
    const text = await fs.readFile(path.join(f.directory, "manifest.json"), "utf8");
    const parse = vi.spyOn(JSON, "parse");
    await f.loader.load("index.html");
    await f.loader.load("index.html");
    expect(parse.mock.calls.filter(([input]) => input === text)).toHaveLength(1);
  });

  it("reloads a changed manifest and cannot reuse an old allowlist/cache", async () => {
    const f = await fixture({ "index.html": "old", "next.html": "new" });
    await f.loader.load("index.html");
    f.manifest.files = f.manifest.files.filter(file => file.path === "next.html");
    f.manifest.fileCount = 1;
    await f.save();
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 404 });
    expect((await f.loader.load("next.html")).bytes.toString()).toBe("new");
  });

  it("does not expose cache buffers to caller mutation", async () => {
    const f = await fixture();
    const first = await f.loader.load("index.html");
    first.bytes.fill(0);
    expect((await f.loader.load("index.html")).bytes.toString()).toBe("<p>Office</p>");
  });

  it("rejects same-size file tampering after a successful cached read", async () => {
    const f = await fixture({ "index.html": "original" });
    await f.loader.load("index.html");
    await fs.writeFile(path.join(f.directory, "index.html"), "tampered");
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects missing or size-mismatched allowlisted assets without leaking paths", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, "index.html"), "different size");
    await expect(f.loader.load("index.html")).rejects.toThrow("Office runtime is unavailable");
    await fs.unlink(path.join(f.directory, "index.html"));
    try { await f.loader.load("index.html"); } catch (error) {
      expect(error).toBeInstanceOf(OfficeAssetError);
      expect(String(error)).not.toContain(f.directory);
      expect(error).not.toHaveProperty("cause");
    }
  });

  it.each([
    {}, { version: 2, mode: "written", files: [] },
    { version: 1, mode: "dry-run", files: [] },
    { version: 1, mode: "written", files: [{ path: "../index.html", bytes: 1, sha256: "0".repeat(64) }] },
    { version: 1, mode: "written", files: [{ path: "manifest.json", bytes: 1, sha256: "0".repeat(64) }] },
    { version: 1, mode: "written", files: [{ path: ".env", bytes: 1, sha256: "0".repeat(64) }] },
    { version: 1, mode: "written", files: [{ path: "server.cjs", bytes: 1, sha256: "0".repeat(64) }] },
    { version: 1, mode: "written", files: [{ path: "index.html", bytes: -1, sha256: "0".repeat(64) }] },
    { version: 1, mode: "written", files: [{ path: "index.html", bytes: 1, sha256: "bad" }] },
    { version: 1, mode: "written", files: [{ path: "index.html", bytes: 65 * 1024 * 1024, sha256: "0".repeat(64) }] },
  ])("fails closed for malformed/unsafe package metadata (%o)", async manifest => {
    const f = await fixture();
    await f.save(manifest);
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects duplicate names even when only their Windows casing differs", async () => {
    const f = await fixture();
    f.manifest.files.push({ ...f.manifest.files[0], path: "INDEX.HTML" });
    f.manifest.fileCount = 2;
    await f.save();
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects invalid/missing manifest files and never falls back to another directory", async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.directory, "manifest.json"), "not json");
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 503 });
    await fs.unlink(path.join(f.directory, "manifest.json"));
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects a directory symlink/junction even for an allowlisted matching file", async () => {
    const f = await fixture({ "assets/chair.png": "fixture image" });
    const outside = await fixture({ "chair.png": "fixture image" });
    await fs.unlink(path.join(f.directory, "assets/chair.png"));
    await fs.rmdir(path.join(f.directory, "assets"));
    await fs.symlink(outside.directory, path.join(f.directory, "assets"), process.platform === "win32" ? "junction" : "dir");
    await expect(f.loader.load("assets/chair.png")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects a configured root reached through a symlink/junction", async () => {
    const f = await fixture(), holder = await fixture();
    const alias = path.join(holder.directory, "alias");
    await fs.symlink(f.directory, alias, process.platform === "win32" ? "junction" : "dir");
    await expect(createOfficeAssetLoader({ directory: alias }).load("index.html"))
      .rejects.toMatchObject({ status: 503 });
  });

  it("rejects a linked manifest", async ({ skip }) => {
    const f = await fixture(), outside = await fixture();
    await fs.unlink(path.join(f.directory, "manifest.json"));
    try { await fs.symlink(path.join(outside.directory, "manifest.json"), path.join(f.directory, "manifest.json"), "file"); }
    catch (error) { if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") { skip(); return; } throw error; }
    await expect(f.loader.load("index.html")).rejects.toMatchObject({ status: 503 });
  });
});
