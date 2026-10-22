import { describe, expect, it } from "vitest";
import { avatarPath, avatarPathFromUrl, detectImageType } from "./avatar";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("detectImageType", () => {
  it("recognizes PNG, JPEG and WebP by their first bytes", () => {
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toEqual({ mime: "image/png", ext: "png" });
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toEqual({
      mime: "image/webp",
      ext: "webp",
    });
  });

  it("refuses anything else, whatever its name says", () => {
    expect(detectImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImageType(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(detectImageType(bytes())).toBeNull();
  });
});

describe("avatar paths", () => {
  const client = "11111111-1111-1111-1111-111111111111";
  const row = "22222222-2222-2222-2222-222222222222";

  it("builds the path under the store folder", () => {
    expect(avatarPath(client, row, "jpg", 1700000000000)).toBe(`aff-store/${client}/${row}-1700000000000.jpg`);
  });

  it("gets the path back from a public URL of the same store only", () => {
    const url = `https://x.supabase.co/storage/v1/object/public/avatars/aff-store/${client}/${row}-1.jpg`;
    expect(avatarPathFromUrl(url, client)).toBe(`aff-store/${client}/${row}-1.jpg`);
    expect(avatarPathFromUrl(url, "33333333-3333-3333-3333-333333333333")).toBeNull();
    expect(avatarPathFromUrl("https://evil.example/a.jpg", client)).toBeNull();
    expect(avatarPathFromUrl(null, client)).toBeNull();
  });
});
