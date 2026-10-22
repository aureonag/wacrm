import { describe, expect, it } from "vitest";
import { normalizeDriveUrl } from "./drive-url";

describe("normalizeDriveUrl", () => {
  it("keeps a pasted link exactly as it is", () => {
    const link = "https://drive.google.com/drive/folders/1AbC_dEf-123?usp=sharing";
    expect(normalizeDriveUrl(`  ${link}  `)).toEqual({ ok: true, url: link });
  });

  it("adds https:// when the scheme is missing", () => {
    expect(normalizeDriveUrl("drive.google.com/drive/folders/abc")).toEqual({
      ok: true,
      url: "https://drive.google.com/drive/folders/abc",
    });
  });

  it("treats an empty field as no link", () => {
    expect(normalizeDriveUrl("")).toEqual({ ok: true, url: null });
    expect(normalizeDriveUrl("   ")).toEqual({ ok: true, url: null });
    expect(normalizeDriveUrl(null)).toEqual({ ok: true, url: null });
  });

  it("refuses what is not a web link", () => {
    expect(normalizeDriveUrl("javascript:alert(1)")).toEqual({ ok: false });
    expect(normalizeDriveUrl("data:text/html,<b>x</b>")).toEqual({ ok: false });
    expect(normalizeDriveUrl("ftp://files.example.com/a")).toEqual({ ok: false });
    expect(normalizeDriveUrl("pasta do drive")).toEqual({ ok: false });
    expect(normalizeDriveUrl("localhost")).toEqual({ ok: false });
  });
});
