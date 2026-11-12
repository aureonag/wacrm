import { describe, expect, it } from "vitest";
import {
  countTasks,
  deliveredLate,
  extractCodeFromTitle,
  isDoneStageName,
  isTaskCompleted,
  normalizeClientCode,
  parseClientInput,
  parseProjectInput,
  ValidationError,
} from "./clients-projects";

describe("parseClientInput", () => {
  it("requires a name and defaults to active", () => {
    expect(parseClientInput({ name: "  Pink Heels ", code: " 00175 " })).toEqual({
      name: "Pink Heels",
      code: "00175",
      status: "active",
      notes: null,
    });
    expect(() => parseClientInput({ name: "  " })).toThrow(ValidationError);
  });

  it("an update only touches the keys that were sent", () => {
    expect(parseClientInput({ status: "inactive" }, true)).toEqual({ status: "inactive" });
    expect(() => parseClientInput({ status: "gone" }, true)).toThrow(ValidationError);
  });
});

describe("parseProjectInput", () => {
  it("validates dates and their order", () => {
    expect(parseProjectInput({ name: "Tráfego", start_date: "2026-10-01", due_date: "2026-10-31" })).toMatchObject({
      name: "Tráfego",
      status: "active",
    });
    expect(() => parseProjectInput({ name: "X", start_date: "2026-10-10", due_date: "2026-10-01" })).toThrow(ValidationError);
    expect(() => parseProjectInput({ name: "X", due_date: "31/10/2026" })).toThrow(ValidationError);
  });

  it("only active or archived", () => {
    expect(() => parseProjectInput({ status: "paused" }, true)).toThrow(ValidationError);
    expect(parseProjectInput({ status: "archived" }, true)).toEqual({ status: "archived" });
  });
});

describe("countTasks", () => {
  it("counts open, done and overdue per key", () => {
    const m = countTasks(
      [
        { key: "p1", status: "done", due_date: "2026-01-01" },
        { key: "p1", status: "open", due_date: "2026-10-01" },
        { key: "p1", status: "open", due_date: "2026-12-01" },
        { key: "p1", status: "open", due_date: null },
        { key: "p2", status: "open", due_date: "2026-09-30" },
      ],
      "2026-10-06",
    );
    expect(m.get("p1")).toEqual({ total: 4, open: 3, done: 1, overdue: 1 });
    expect(m.get("p2")).toEqual({ total: 1, open: 1, done: 0, overdue: 1 });
    expect(m.get("p3")).toBeUndefined();
  });

  it("counts a task in a finished stage as done, never overdue, even when it is past its due date", () => {
    const m = countTasks(
      [
        // Dragged into "Concluído" but its own status was never flipped, due date long gone.
        { key: "p1", status: "open", due_date: "2026-09-01", stage_done: true },
        // Same, finished stage and marked done.
        { key: "p1", status: "done", due_date: "2026-09-01", stage_done: true },
        // Really still open and late.
        { key: "p1", status: "open", due_date: "2026-09-01", stage_done: false },
        { key: "p1", status: "open", due_date: "2026-09-01" },
      ],
      "2026-10-06",
    );
    expect(m.get("p1")).toEqual({ total: 4, open: 2, done: 2, overdue: 2 });
  });
});

describe("isDoneStageName", () => {
  it("recognises finished columns, with or without accents and gender", () => {
    for (const n of ["Concluído", "concluido", "Concluída", " CONCLUÍDO ", "Finalizado", "Finalizadas"]) {
      expect(isDoneStageName(n)).toBe(true);
    }
  });

  it("does not match columns that merely mention it", () => {
    for (const n of ["A fazer", "Em andamento", "Concluir revisão", "Não concluído", "Aguardando conclusão", "", null, undefined]) {
      expect(isDoneStageName(n)).toBe(false);
    }
  });
});

describe("deliveredLate / isTaskCompleted", () => {
  it("is late only when finished after the due date", () => {
    expect(deliveredLate("2026-10-10", "2026-10-06")).toBe(true);
    expect(deliveredLate("2026-10-06", "2026-10-06")).toBe(false);
    expect(deliveredLate("2026-10-01", "2026-10-06")).toBe(false);
  });

  it("does not guess when a date is missing", () => {
    expect(deliveredLate(null, "2026-10-06")).toBe(false);
    expect(deliveredLate("2026-10-10", null)).toBe(false);
    expect(deliveredLate(undefined, undefined)).toBe(false);
  });

  it("completed means done or in a finished stage", () => {
    expect(isTaskCompleted("done", false)).toBe(true);
    expect(isTaskCompleted("open", true)).toBe(true);
    expect(isTaskCompleted("open", false)).toBe(false);
    expect(isTaskCompleted("open", undefined)).toBe(false);
  });
});

describe("client / contract code", () => {
  it("standardizes numeric codes to 5 digits and keeps the rest", () => {
    expect(normalizeClientCode("0080")).toBe("00080");
    expect(normalizeClientCode(" 351 ")).toBe("00351");
    expect(normalizeClientCode("00351")).toBe("00351");
    expect(normalizeClientCode("123456")).toBe("123456");
    expect(normalizeClientCode("AB-12")).toBe("AB-12");
    expect(normalizeClientCode("   ")).toBeNull();
    expect(normalizeClientCode(undefined)).toBeNull();
  });

  it("reads the contract number from a deal or kickoff task title", () => {
    expect(extractCodeFromTitle("00351 - CG Complemento")).toBe("00351");
    expect(extractCodeFromTitle("Kickoff - 00353 - Scarliet Estrias")).toBe("00353");
    expect(extractCodeFromTitle("kickoff - 351 - Fulano")).toBe("00351");
    expect(extractCodeFromTitle("DAILY MÍDIA - TAREFAS DO DIA")).toBeNull();
    expect(extractCodeFromTitle("2026 planning")).toBeNull();
    expect(extractCodeFromTitle(null)).toBeNull();
  });

  it("the client form saves the standardized code", () => {
    expect(parseClientInput({ name: "Ala Turca", code: "80" }).code).toBe("00080");
  });
});
