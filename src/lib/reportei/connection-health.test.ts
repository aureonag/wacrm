import { describe, expect, it } from "vitest";
import { connectionDownNotice, isTokenRejected } from "./connection-health";

describe("isTokenRejected", () => {
  it("is true only for Meta's invalid-token code", () => {
    expect(isTokenRejected({ error: { code: 190 } })).toBe(true);
    expect(isTokenRejected({ error: { code: 200 } })).toBe(false);
    expect(isTokenRejected({ error: { code: 4 } })).toBe(false);
    expect(isTokenRejected({})).toBe(false);
    expect(isTokenRejected(undefined)).toBe(false);
  });
});

describe("connectionDownNotice", () => {
  it("names the login and says where to reconnect", () => {
    const n = connectionDownNotice("Allan Giro");
    expect(n.type).toBe("integration_down");
    expect(n.title).toContain("Allan Giro");
    expect(n.body).toContain("Reconecte");
  });

  it("works without a name", () => {
    expect(connectionDownNotice(null).title).toBe("A conexão com a Meta caiu");
  });
});
