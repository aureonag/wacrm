import { describe, expect, it } from "vitest";
import { composeMembers, isTaskMember, memberInitials, splitMembers } from "./members";

describe("composeMembers", () => {
  it("puts the assignee first and drops repeats", () => {
    const out = composeMembers({ id: "a", full_name: "Ana Souza" }, [
      { id: "b", full_name: "Bia" },
      { id: "a", full_name: "Ana Souza" },
    ]);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("works without an assignee", () => {
    expect(composeMembers(null, [{ id: "b", full_name: "Bia", avatar_url: "u" }])).toEqual([
      { id: "b", name: "Bia", avatarUrl: "u" },
    ]);
  });
});

describe("splitMembers", () => {
  it("first is the assignee, the rest participants", () => {
    expect(splitMembers(["a", "b", "c", "b"])).toEqual({ assigneeId: "a", participantIds: ["b", "c"] });
  });

  it("empty list clears the assignee", () => {
    expect(splitMembers([])).toEqual({ assigneeId: null, participantIds: [] });
  });
});

describe("isTaskMember", () => {
  it("matches assignee or participants", () => {
    const task = { assignee_id: "a", members: [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
    expect(isTaskMember(task, "a")).toBe(true);
    expect(isTaskMember(task, "b")).toBe(true);
    expect(isTaskMember(task, "c")).toBe(false);
    expect(isTaskMember(task, null)).toBe(false);
  });
});

describe("memberInitials", () => {
  it("uses first and last name", () => {
    expect(memberInitials("Vitor Prete")).toBe("VP");
    expect(memberInitials("Midia")).toBe("MI");
    expect(memberInitials("  ")).toBe("?");
  });
});
