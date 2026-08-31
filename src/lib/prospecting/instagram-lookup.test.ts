import { describe, expect, it } from "vitest";
import { findInstagramFromWebsiteLinks, isInstagramProviderConfigured } from "./instagram-lookup";

describe("isInstagramProviderConfigured", () => {
  it("is false in this version (heuristic-only, documented)", () => {
    expect(isInstagramProviderConfigured()).toBe(false);
  });
});

describe("findInstagramFromWebsiteLinks", () => {
  it("finds and normalizes an Instagram link among other social links", () => {
    const result = findInstagramFromWebsiteLinks([
      "https://wa.me/5511999998888",
      "https://instagram.com/Clinica_Exemplo/",
      "https://facebook.com/clinicaexemplo",
    ]);
    expect(result).toEqual({
      handle: "clinica_exemplo",
      profileUrl: "https://instagram.com/clinica_exemplo",
      source: "website",
      followers: null,
      engagement: null,
    });
  });

  it("returns an all-null result when no Instagram link is present, never inventing one", () => {
    const result = findInstagramFromWebsiteLinks(["https://facebook.com/clinicaexemplo"]);
    expect(result).toEqual({ handle: null, profileUrl: null, source: null, followers: null, engagement: null });
  });

  it("never fabricates followers or engagement even when a handle is found", () => {
    const result = findInstagramFromWebsiteLinks(["https://instagram.com/acme"]);
    expect(result.followers).toBeNull();
    expect(result.engagement).toBeNull();
  });
});
