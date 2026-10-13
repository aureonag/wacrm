import { describe, expect, it } from "vitest";
import { loginUrlFor, safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it("accepts in-site paths with query", () => {
    expect(safeNextPath("/operational/boards/abc?task=123")).toBe("/operational/boards/abc?task=123");
    expect(safeNextPath("/pipelines/deals/1")).toBe("/pipelines/deals/1");
  });

  it("rejects other sites and tricks", () => {
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("//evil.com/x")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it("does not loop into the auth pages", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login?next=/x")).toBeNull();
    expect(safeNextPath("/signup?invite=1")).toBeNull();
  });
});

describe("loginUrlFor", () => {
  it("encodes the path", () => {
    expect(loginUrlFor("/operational/boards/a?task=b")).toBe("/login?next=%2Foperational%2Fboards%2Fa%3Ftask%3Db");
  });

  it("falls back to plain /login for unsafe paths", () => {
    expect(loginUrlFor("//evil.com")).toBe("/login");
  });
});
