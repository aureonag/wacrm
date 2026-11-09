import { describe, expect, it } from "vitest";
import { parseDoc } from "./doc";
import { demoSource } from "./doc-catalog";
import { EXPERT_SEEDS, GENERIC_EXPERT_LAYOUT, MY_TEMPLATE_SEEDS, REPORTEI_TEMPLATES, buildDocFromTemplate, findBuiltin, layoutOfDoc, layoutSummary, parseLayout, type TemplateLayout } from "./doc-templates";

const range = { since: "2026-10-01", until: "2026-10-31" };
let n = 0;
const ids = (p: string) => `${p}_k${++n}`;
const build = (layout: TemplateLayout, integrations: { network: string; account: string }[]) => {
  n = 0;
  return buildDocFromTemplate({ layout, integrations, range, seed: "t", source: demoSource }, ids);
};

describe("the templates that come with the system", () => {
  it("has the four of Reportei and the nine of Meus templates, all with a valid layout", () => {
    expect(REPORTEI_TEMPLATES.map((t) => t.name)).toEqual(["Padrão", "E-commerce", "Recebidas", "Tráfego Pago"]);
    expect(MY_TEMPLATE_SEEDS).toHaveLength(9);
    for (const t of [...REPORTEI_TEMPLATES, ...MY_TEMPLATE_SEEDS]) {
      const parsed = parseLayout(t.layout);
      expect(parsed, t.name).not.toBeNull();
      // nothing was dropped: every key and network named is real
      expect(parsed, t.name).toEqual(t.layout);
    }
    expect(parseLayout(GENERIC_EXPERT_LAYOUT)).toEqual(GENERIC_EXPERT_LAYOUT);
  });

  it("each front grows with the level: basic < intermediate < advanced", () => {
    const size = (name: string) => MY_TEMPLATE_SEEDS.find((t) => t.name === name)!.layout.blocks.reduce((s, b) => s + b.keys.length, 0);
    for (const front of ["Geração de leads", "E-commerce", "Social media"]) {
      expect(size(`${front} — Básico`)).toBeLessThan(size(`${front} — Intermediário`));
      expect(size(`${front} — Intermediário`)).toBeLessThan(size(`${front} — Avançado`));
    }
  });

  it("the fronts look at different things", () => {
    const keys = (name: string) => MY_TEMPLATE_SEEDS.find((t) => t.name === name)!.layout.blocks.flatMap((b) => b.keys);
    expect(keys("Geração de leads — Básico")).toContain("cost_per_lead");
    expect(keys("E-commerce — Básico")).toContain("roas");
    expect(keys("Social media — Básico")).toContain("followers");
    expect(keys("Geração de leads — Básico")).not.toContain("roas");
  });

  it("names the three experts of the team and finds a built-in by id", () => {
    expect(EXPERT_SEEDS.map((e) => e.profileName)).toEqual(["Matheus Machado", "Bruna Natali", "Mauro Soares"]);
    expect(EXPERT_SEEDS[0].description("Matheus")).toContain("Matheus");
    expect(findBuiltin("builtin:padrao")?.name).toBe("Padrão");
    expect(findBuiltin("nope")).toBeNull();
  });
});

describe("buildDocFromTemplate", () => {
  const padrao = findBuiltin("builtin:padrao")!.layout;

  it("makes a block for each chosen integration of a network the layout has, plus the custom one", () => {
    const doc = build(padrao, [{ network: "instagram_business", account: "amex.log" }, { network: "facebook", account: "AmexLog Transporte" }]);
    expect(doc.demo).toBe(true);
    expect(doc.blocks.map((b) => b.kind)).toEqual(["custom", "network", "network"]);
    expect(doc.blocks.map((b) => b.network)).toEqual([undefined, "instagram_business", "facebook"]);
    expect(doc.blocks[1].subtitle).toBe("amex.log");
    expect(parseDoc(doc)).not.toBeNull();
  });

  it("leaves out the networks with no chosen integration and the totals whose networks are not there", () => {
    const doc = build(findBuiltin("builtin:trafego-pago")!.layout, [{ network: "meta_ads", account: "Conta" }]);
    expect(doc.blocks.map((b) => b.network)).toEqual([undefined, "meta_ads"]);
    const custom = doc.blocks[0].widgets;
    expect(custom.map((w) => w.key)).toEqual(["total_spend", "total_leads", "total_cost_per_lead"]);
    for (const w of custom) if (w.kind === "metric") expect(w.networks).toEqual(["meta_ads"]);

    const social = build(findBuiltin("builtin:trafego-pago")!.layout, [{ network: "facebook", account: "Pagina" }]);
    expect(social.blocks.map((b) => b.kind)).toEqual(["network"]); // no ad network: no totals
    expect(social.blocks[0].network).toBe("facebook");
  });

  it("gives a chosen network the layout does not have its usual indicators, and one block per account", () => {
    const doc = build(findBuiltin("builtin:ecommerce")!.layout, [{ network: "youtube", account: "Canal" }, { network: "meta_ads", account: "A" }, { network: "meta_ads", account: "B" }]);
    expect(doc.blocks.filter((b) => b.network === "meta_ads").map((b) => b.subtitle)).toEqual(["A", "B"]);
    const yt = doc.blocks.find((b) => b.network === "youtube")!;
    expect(yt.widgets.length).toBeGreaterThan(3);
    // the layout's networks come first, in its order
    expect(doc.blocks.findIndex((b) => b.network === "meta_ads")).toBeLessThan(doc.blocks.findIndex((b) => b.network === "youtube"));
  });

  it("is deterministic for the same seed and valid for every template with every network connected", () => {
    const all = ["instagram_business", "facebook", "meta_ads", "google_ads", "tiktok_ads", "google_analytics_4", "youtube", "tiktok", "linkedin"].map((network) => ({ network, account: network }));
    for (const t of [...REPORTEI_TEMPLATES, ...MY_TEMPLATE_SEEDS]) {
      const a = build(t.layout, all);
      expect(parseDoc(a), t.name).not.toBeNull();
      expect(build(t.layout, all)).toEqual(a);
    }
  });
});

describe("saving a report as a template", () => {
  it("gives back the same layout it was made from", () => {
    const layout = findBuiltin("builtin:recebidas")!.layout;
    const doc = build(layout, [{ network: "facebook", account: "F" }, { network: "instagram_business", account: "I" }, { network: "google_analytics_4", account: "G" }, { network: "linkedin", account: "L" }]);
    const back = layoutOfDoc(doc);
    expect(back.blocks).toEqual(layout.blocks);
    expect(back.custom.map((c) => c.key)).toEqual(layout.custom.map((c) => c.key));
  });
});

describe("parseLayout and layoutSummary", () => {
  it("drops unknown keys and networks inside a block, refuses malformed input", () => {
    expect(parseLayout({ custom: [], blocks: [{ network: "meta_ads", keys: ["spend", "nope"] }] })).toEqual({ custom: [], blocks: [{ network: "meta_ads", keys: ["spend"] }] });
    expect(parseLayout({ custom: [], blocks: [{ network: "myspace", keys: ["x"] }] })).toBeNull();
    expect(parseLayout({ custom: [], blocks: [{ network: "meta_ads", keys: ["nope"] }] })).toBeNull();
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout({ blocks: "x" })).toBeNull();
    expect(parseLayout({ custom: [{ key: "bogus", networks: [] }], blocks: [] })).toBeNull();
  });

  it("summarises blocks with the titles of their indicators", () => {
    const s = layoutSummary({ custom: [{ key: "total_spend", networks: ["meta_ads"] }], blocks: [{ network: "meta_ads", keys: ["spend", "roas"] }] });
    expect(s[0]).toEqual({ network: null, title: "Bloco Personalizado", indicators: ["Investimento total em mídia"] });
    expect(s[1].indicators).toEqual(["Valor gasto", "ROAS"]);
  });
});
