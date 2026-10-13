import { describe, expect, it } from "vitest";
import { applyColumnOrder, applyOrderByStage, moveInOrder, resolveDrop } from "./column-order";

const items = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((i) => i.id);

describe("applyColumnOrder", () => {
  it("keeps the natural order with no saved order", () => {
    expect(ids(applyColumnOrder(items("a", "b", "c"), undefined))).toEqual(["a", "b", "c"]);
    expect(ids(applyColumnOrder(items("a", "b"), []))).toEqual(["a", "b"]);
  });

  it("follows the saved order", () => {
    expect(ids(applyColumnOrder(items("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("puts cards that are not in the saved list on top, in natural order", () => {
    expect(ids(applyColumnOrder(items("a", "n1", "b", "n2"), ["b", "a"]))).toEqual(["n1", "n2", "b", "a"]);
  });

  it("ignores saved ids that no longer exist", () => {
    expect(ids(applyColumnOrder(items("a", "b"), ["x", "b", "a"]))).toEqual(["b", "a"]);
  });
});

describe("moveInOrder", () => {
  const list = ["a", "b", "c", "d"];

  it("moves to the top and to the end", () => {
    expect(moveInOrder(list, "c", "top")).toEqual(["c", "a", "b", "d"]);
    expect(moveInOrder(list, "b", "end")).toEqual(["a", "c", "d", "b"]);
  });

  it("moves before and after a card", () => {
    expect(moveInOrder(list, "d", { beforeId: "b" })).toEqual(["a", "d", "b", "c"]);
    expect(moveInOrder(list, "a", { afterId: "c" })).toEqual(["b", "c", "a", "d"]);
  });

  it("inserts a card coming from another column", () => {
    expect(moveInOrder(list, "z", { beforeId: "c" })).toEqual(["a", "b", "z", "c", "d"]);
  });

  it("falls back to the top when the anchor is unknown", () => {
    expect(moveInOrder(list, "b", { afterId: "nope" })).toEqual(["b", "a", "c", "d"]);
  });
});

describe("applyOrderByStage", () => {
  it("applies each stage's own order", () => {
    const cards = [
      { id: "a", stage: "s1" },
      { id: "b", stage: "s1" },
      { id: "c", stage: "s2" },
      { id: "d", stage: "s2" },
    ];
    const out = applyOrderByStage(cards, (c) => c.stage, { s1: ["b", "a"] });
    expect(out.filter((c) => c.stage === "s1").map((c) => c.id)).toEqual(["b", "a"]);
    expect(out.filter((c) => c.stage === "s2").map((c) => c.id)).toEqual(["c", "d"]);
  });
});

describe("resolveDrop", () => {
  const stageOfCard = (id: string) => (id === "x" ? "s1" : id === "y" ? "s2" : null);

  it("drops before a card when the dragged card is in its upper half", () => {
    const r = resolveDrop({
      overId: "card:x",
      stageOfCard,
      overRect: { top: 100, height: 100 },
      activeRect: { top: 60, height: 40 },
      activeId: "z",
    });
    expect(r).toEqual({ stageId: "s1", target: { beforeId: "x" }, overCardId: "x" });
  });

  it("drops after a card when it is in its lower half", () => {
    const r = resolveDrop({
      overId: "card:y",
      stageOfCard,
      overRect: { top: 100, height: 100 },
      activeRect: { top: 160, height: 40 },
      activeId: "z",
    });
    expect(r).toEqual({ stageId: "s2", target: { afterId: "y" }, overCardId: "y" });
  });

  it("drops at the end of the column when over the column itself", () => {
    expect(resolveDrop({ overId: "s9", stageOfCard, activeId: "z" })).toEqual({
      stageId: "s9",
      target: "end",
      overCardId: null,
    });
  });

  it("ignores a drop on itself or on an unknown card", () => {
    expect(resolveDrop({ overId: "card:z", stageOfCard, activeId: "z" })).toBeNull();
    expect(resolveDrop({ overId: "card:nope", stageOfCard, activeId: "z" })).toBeNull();
    expect(resolveDrop({ overId: null, stageOfCard, activeId: "z" })).toBeNull();
  });
});
