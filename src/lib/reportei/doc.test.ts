import { describe, expect, it } from "vitest";
import {
  addBlock, addWidgets, changeOf, deleteBlock, deleteWidget, duplicateWidget, findWidget, formatValue, isWidget, moveBlock, moveWidget, swapWidgets,
  parseDoc, sortRows, toggleHighlight, toggleSize, updateBlock, updateCover, updateWidget, widgetToCsv, type MetricWidget, type ReportDoc,
} from "./doc";
import { CATALOG_NETWORKS, NETWORK_CATALOG, buildDemoDoc, catalogEntry, daysOf, rng } from "./doc-catalog";

const range = { since: "2026-10-01", until: "2026-10-31" };
let n = 0;
const ids = (p: string) => `${p}_t${++n}`;

const doc = (): ReportDoc => {
  n = 0;
  return buildDemoDoc({ seed: "amexlog", range, networks: [{ network: "instagram_business", account: "amex.log" }, { network: "facebook", account: "AmexLog Transporte" }] }, ids);
};

describe("the model documents", () => {
  it("every catalog entry makes a valid indicator, and the same seed gives the same numbers", () => {
    for (const network of CATALOG_NETWORKS) {
      for (const entry of NETWORK_CATALOG[network]) {
        const a = entry.make({ id: "w1", range, seed: "s" });
        expect(isWidget(a), `${network}/${entry.key}`).toBe(true);
        expect(a.kind).toBe(entry.kind);
        expect(entry.make({ id: "w1", range, seed: "s" })).toEqual(a);
      }
    }
  });

  it("a demo document is valid, flagged as made up, with the custom block first", () => {
    const d = doc();
    expect(parseDoc(d)).not.toBeNull();
    expect(d.demo).toBe(true);
    expect(d.blocks.map((b) => b.kind)).toEqual(["custom", "network", "network"]);
    expect(d.blocks[1].title).toBe("Instagram Business");
    expect(d.blocks[1].subtitle).toBe("amex.log");
    expect(d.blocks[1].widgets.length).toBeGreaterThan(10);
  });

  it("a report without social networks has no custom block", () => {
    const d = buildDemoDoc({ seed: "x", range, networks: [{ network: "meta_ads", account: "Conta" }] }, ids);
    expect(d.blocks.map((b) => b.kind)).toEqual(["network"]);
  });

  it("daily labels cover the range", () => {
    expect(daysOf(range)).toHaveLength(31);
    expect(daysOf(range)[0]).toBe("01/10/2026");
    const r = rng("a");
    expect(r()).toBeGreaterThanOrEqual(0);
    expect(rng("a")()).toBe(rng("a")());
  });
});

describe("editing operations", () => {
  it("highlights and resizes without touching anything else", () => {
    const d = doc();
    const w = d.blocks[1].widgets[0];
    const h = toggleHighlight(d, w.id);
    expect(findWidget(h, w.id)!.block.widgets[0].highlight).toBe(true);
    expect(toggleHighlight(h, w.id).blocks[1].widgets[0].highlight).toBe(false);
    expect(toggleSize(d, w.id).blocks[1].widgets[0].size).toBe("wide");
    expect(d.blocks[1].widgets[0].size).toBe("normal"); // the original is not changed
  });

  it("duplicates right after the original with a new id and no highlight", () => {
    let d = doc();
    const w = d.blocks[1].widgets[2];
    d = toggleHighlight(d, w.id);
    const copied = duplicateWidget(d, w.id, ids);
    const list = copied.blocks[1].widgets;
    expect(list).toHaveLength(d.blocks[1].widgets.length + 1);
    expect(list[3].id).not.toBe(w.id);
    expect(list[3].title).toBe(w.title);
    expect(list[3].highlight).toBe(false);
    expect(parseDoc(copied)).not.toBeNull();
  });

  it("deletes an indicator and a block", () => {
    const d = doc();
    const w = d.blocks[1].widgets[0];
    expect(findWidget(deleteWidget(d, w.id), w.id)).toBeNull();
    expect(deleteBlock(d, d.blocks[2].id).blocks).toHaveLength(2);
  });

  it("moves an indicator inside a block and across blocks", () => {
    const d = doc();
    const block = d.blocks[1];
    const last = block.widgets[block.widgets.length - 1];
    const first = moveWidget(d, last.id, block.id, 0);
    expect(first.blocks[1].widgets[0].id).toBe(last.id);
    expect(first.blocks[1].widgets).toHaveLength(block.widgets.length);

    const across = moveWidget(d, last.id, d.blocks[2].id, 1);
    expect(across.blocks[2].widgets[1].id).toBe(last.id);
    expect(across.blocks[1].widgets).toHaveLength(block.widgets.length - 1);
    expect(parseDoc(across)).not.toBeNull();
  });

  it("swaps two indicators, inside a block and across blocks, keeping each one's settings", () => {
    const d = doc();
    const [a, b] = d.blocks[1].widgets;
    const same = swapWidgets(d, a.id, b.id);
    expect(same.blocks[1].widgets[0]).toEqual(b);
    expect(same.blocks[1].widgets[1]).toEqual(a);
    expect(same.blocks[1].widgets).toHaveLength(d.blocks[1].widgets.length);

    const c = d.blocks[2].widgets[0];
    const across = swapWidgets(d, a.id, c.id);
    expect(across.blocks[1].widgets[0]).toEqual(c);
    expect(across.blocks[2].widgets[0]).toEqual(a);
    expect(across.blocks[2].widgets).toHaveLength(d.blocks[2].widgets.length);
    expect(parseDoc(across)).not.toBeNull();

    expect(swapWidgets(d, a.id, a.id)).toBe(d);
    expect(swapWidgets(d, a.id, "nope")).toBe(d);
  });

  it("ignores moves to places that do not exist and clamps the position", () => {
    const d = doc();
    const w = d.blocks[1].widgets[0];
    expect(moveWidget(d, w.id, "nope", 0)).toBe(d);
    expect(moveWidget(d, "nope", d.blocks[1].id, 0)).toBe(d);
    expect(moveWidget(d, w.id, d.blocks[2].id, 999).blocks[2].widgets.at(-1)!.id).toBe(w.id);
  });

  it("adds indicators to a block and edits one", () => {
    const d = doc();
    const extra = catalogEntry("instagram_business", "comments")!.make({ id: "w_new", range, seed: "x" });
    const added = addWidgets(d, d.blocks[1].id, [extra]);
    expect(added.blocks[1].widgets.at(-1)!.id).toBe("w_new");
    const edited = updateWidget(added, "w_new", { title: "Outro título", decimals: 1 } as Partial<MetricWidget>);
    const w = findWidget(edited, "w_new")!.block.widgets.at(-1) as MetricWidget;
    expect(w.title).toBe("Outro título");
    expect(w.kind).toBe("metric");
    expect(w.id).toBe("w_new");
  });

  it("edits blocks, the cover and the order of blocks", () => {
    let d = doc();
    d = updateBlock(d, d.blocks[1].id, { analysis: "Crescemos.", hidden: true });
    expect(d.blocks[1].analysis).toBe("Crescemos.");
    expect(d.blocks[1].hidden).toBe(true);
    expect(updateCover(d, { hidden: true, analysis: "Resumo" }).cover).toMatchObject({ hidden: true, analysis: "Resumo" });
    const moved = moveBlock(d, d.blocks[2].id, 1);
    expect(moved.blocks[1].id).toBe(d.blocks[2].id);
    const extra = { ...d.blocks[2], id: "b_extra", widgets: [] };
    expect(addBlock(d, extra, 1).blocks[1].id).toBe("b_extra");
  });
});

describe("showing a number", () => {
  const w = (over: Partial<MetricWidget>): MetricWidget => ({
    id: "m", kind: "metric", title: "T", description: "", size: "normal", highlight: false, period: null,
    value: 5121, previous: 5066, decimals: 0, format: "int", comparison: true, absolute: false, upIsGood: true, networks: [], ...over,
  });

  it("preserves currency, treats spend as context, and exports unavailable as a state", () => {
    expect(formatValue(1234.5, "money", 2, "USD")).toContain("US$");
    expect(changeOf(w({ key: "spend" }))?.tone).toBe("neutral");
    expect(changeOf(w({ key: "total_spend", absolute: true }))?.tone).toBe("neutral");
    const csv = widgetToCsv(w({ value: 0, previous: null, unavailable: "Sem acesso à conta" }));
    expect(csv).toContain("Sem acesso à conta");
    expect(csv).not.toContain(";0;");
  });

  it("formats in pt-BR", () => {
    expect(formatValue(43694, "int", 0)).toBe("43.694");
    expect(formatValue(2.5, "percent", 2)).toBe("2,50%");
    expect(formatValue(1234.5, "money", 2)).toContain("1.234,50");
  });

  it("computes the change with its tone", () => {
    expect(changeOf(w({}))).toEqual({ text: "+1,09%", tone: "good", up: true });
    expect(changeOf(w({ value: 1378, previous: 1797 }))).toEqual({ text: "−23,32%", tone: "bad", up: false });
    // A cost going down is good.
    expect(changeOf(w({ value: 1, previous: 2, upIsGood: false }))?.tone).toBe("good");
  });

  it("can show the absolute difference, or nothing", () => {
    expect(changeOf(w({ value: 120, previous: 100, absolute: true }))?.text).toBe("+20");
    expect(changeOf(w({ comparison: false }))).toBeNull();
    expect(changeOf(w({ previous: null }))).toBeNull();
    expect(changeOf(w({ previous: 0 }))).toBeNull();
  });
});

describe("export and sorting", () => {
  it("exports a number, a series, a table and stories as CSV", () => {
    const d = doc();
    const head = (csv: string) => csv.slice(1).split("\r\n")[0];
    const byKind = (k: string) => d.blocks[1].widgets.find((x) => x.kind === k)!;
    const metric = widgetToCsv(byKind("metric"));
    expect(metric.charCodeAt(0)).toBe(0xfeff);
    expect(head(metric)).toBe("Indicador;Valor;Período anterior;Variação");
    expect(head(widgetToCsv(byKind("bar")))).toBe("Data;Seguidores");
    expect(head(widgetToCsv(byKind("table")))).toBe("Cidade;Seguidores");
    expect(head(widgetToCsv(byKind("groupedBar")))).toBe("Categoria;Masculino;Feminino;Desconhecido");
    expect(head(widgetToCsv(byKind("stories"))).startsWith("Data;Visualizações")).toBe(true);
    expect(head(widgetToCsv(byKind("posts"))).startsWith("Postagem;Tipo")).toBe(true);
  });

  it("defuses a formula in an exported cell", () => {
    const d = doc();
    const t = updateWidget(d, d.blocks[1].widgets.find((x) => x.kind === "table")!.id, { rows: [{ city: "=HYPERLINK()", followers: 1 }] } as never);
    expect(widgetToCsv(findWidget(t, d.blocks[1].widgets.find((x) => x.kind === "table")!.id)!.block.widgets.find((x) => x.kind === "table")!)).toContain("'=HYPERLINK()");
  });

  it("sorts rows high to low for numbers and by name for text", () => {
    expect(sortRows([{ a: 1 }, { a: 3 }, { a: 2 }], "a").map((r) => r.a)).toEqual([3, 2, 1]);
    expect(sortRows([{ a: "b" }, { a: "a" }], "a").map((r) => r.a)).toEqual(["a", "b"]);
    const rows = [{ a: 1 }, { a: 2 }];
    expect(sortRows(rows, null)).toEqual(rows);
    expect(sortRows(rows, null)).not.toBe(rows);
  });
});

describe("parseDoc", () => {
  it("refuses what is not a well-formed document", () => {
    expect(parseDoc(null)).toBeNull();
    expect(parseDoc({})).toBeNull();
    expect(parseDoc({ ...doc(), version: 2 })).toBeNull();
    expect(parseDoc({ ...doc(), demo: "yes" })).toBeNull();
    expect(parseDoc({ ...doc(), cover: { hidden: false } })).toBeNull();
  });

  it("refuses a widget of an unknown kind or with bad numbers", () => {
    const d = doc();
    const bad = structuredClone(d);
    (bad.blocks[1].widgets[0] as { kind: string }).kind = "script";
    expect(parseDoc(bad)).toBeNull();
    const nan = structuredClone(d);
    (nan.blocks[1].widgets[0] as MetricWidget).value = Number.NaN;
    expect(parseDoc(nan)).toBeNull();
  });

  it("refuses repeated ids and too many blocks", () => {
    const d = doc();
    const dup = structuredClone(d);
    dup.blocks[2].widgets[0].id = dup.blocks[1].widgets[0].id;
    expect(parseDoc(dup)).toBeNull();
    const many = { ...d, blocks: Array.from({ length: 21 }, (_, i) => ({ ...d.blocks[0], id: `b${i}`, widgets: [] })) };
    expect(parseDoc(many)).toBeNull();
  });
});
