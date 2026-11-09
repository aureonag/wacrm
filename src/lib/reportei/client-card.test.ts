import { describe, expect, it } from "vitest";
import { healthOf, hueOf, initials, logoPath, logoPathFromUrl, networksOf, reportStatsByClient } from "./client-card";

describe("healthOf", () => {
  it("is none without integrations, ok when all are connected, attention otherwise", () => {
    expect(healthOf([])).toBe("none");
    expect(healthOf(["connected", "connected"])).toBe("ok");
    expect(healthOf(["connected", "error"])).toBe("attention");
    expect(healthOf(["revoked"])).toBe("attention");
  });
});

describe("networksOf", () => {
  it("lists each network once, sorted", () => {
    expect(networksOf(["meta_ads", "google_ads", "meta_ads"])).toEqual(["google_ads", "meta_ads"]);
    expect(networksOf([])).toEqual([]);
  });
});

describe("reportStatsByClient", () => {
  it("counts and finds the newest report per client", () => {
    const stats = reportStatsByClient([
      { client_id: "a", created_at: "2026-11-01T10:00:00Z" },
      { client_id: "a", created_at: "2026-11-03T10:00:00Z" },
      { client_id: "b", created_at: "2026-10-01T10:00:00Z" },
    ]);
    expect(stats.get("a")).toEqual({ count: 2, last: "2026-11-03T10:00:00Z" });
    expect(stats.get("b")).toEqual({ count: 1, last: "2026-10-01T10:00:00Z" });
    expect(stats.get("c")).toBeUndefined();
  });
});

describe("logo paths", () => {
  const client = "11111111-1111-1111-1111-111111111111";

  it("builds the path inside the client's folder", () => {
    expect(logoPath(client, "png", 5)).toBe(`reportei-clients/${client}/logo-5.png`);
  });

  it("only recognises logos of this client", () => {
    const url = `https://x.supabase.co/storage/v1/object/public/avatars/reportei-clients/${client}/logo-5.png?t=1`;
    expect(logoPathFromUrl(url, client)).toBe(`reportei-clients/${client}/logo-5.png`);
    expect(logoPathFromUrl(url, "22222222-2222-2222-2222-222222222222")).toBeNull();
    expect(logoPathFromUrl("https://x/avatars/aff-store/z/p.png", client)).toBeNull();
    expect(logoPathFromUrl(`https://x/avatars/reportei-clients/${client}/../other.png`, client)).toBeNull();
    expect(logoPathFromUrl(null, client)).toBeNull();
  });
});

describe("placeholder", () => {
  it("takes one or two capital letters", () => {
    expect(initials("Aurok")).toBe("A");
    expect(initials("  clínica   ro ")).toBe("CR");
    expect(initials("")).toBe("?");
  });

  it("keeps the same hue for the same name", () => {
    expect(hueOf("Aurok")).toBe(hueOf("Aurok"));
    expect(hueOf("Aurok")).toBeGreaterThanOrEqual(0);
    expect(hueOf("Aurok")).toBeLessThan(360);
  });
});

import { demoNetworks } from "./client-card";

describe("demoNetworks", () => {
  const all = ["meta_ads", "facebook", "instagram_business", "google_ads", "youtube", "linkedin", "tiktok", "google_analytics_4"];

  it("gives 2 to 5 distinct networks, the same every time for the same client", () => {
    for (const name of ["Aurok", "4 Irmãos", "Pandora", "A.N. PETS"]) {
      const a = demoNetworks(name, all);
      expect(a).toEqual(demoNetworks(name, all));
      expect(new Set(a).size).toBe(a.length);
      expect(a.length).toBeGreaterThanOrEqual(2);
      expect(a.length).toBeLessThanOrEqual(5);
      for (const n of a) expect(all).toContain(n);
    }
  });

  it("mixes: different clients do not all get the same set", () => {
    const sets = new Set(["Aurok", "4 Irmãos", "Pandora", "A.N. PETS", "Hawapi", "CG Complemento"].map((n) => demoNetworks(n, all).join(",")));
    expect(sets.size).toBeGreaterThan(2);
  });

  it("handles an empty or tiny catalog", () => {
    expect(demoNetworks("x", [])).toEqual([]);
    expect(demoNetworks("x", ["meta_ads"])).toEqual(["meta_ads"]);
  });
});
