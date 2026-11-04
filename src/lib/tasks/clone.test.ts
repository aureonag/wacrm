import { describe, expect, it } from "vitest";
import { buildClonedTaskRow, CLONED_TASK_COLUMNS } from "./clone";

const source = {
  id: "src-1",
  account_id: "acc-1",
  board_id: "board-1",
  stage_id: "stage-1",
  parent_task_id: null,
  title: "Feed - Aura Matra",
  contact_id: "contact-1",
  sector_id: "sector-1",
  project_id: "project-1",
  deal_id: "deal-1",
  assignee_id: "profile-1",
  priority: "high",
  is_urgent: true,
  briefing: { type: "doc", content: [] },
  position: 7,
  status: "completed",
  start_date: "2026-11-06",
  due_date: "2026-11-06",
  estimated_minutes: 90,
  created_by: "user-old",
  completed_at: "2026-11-07T10:00:00Z",
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-02T10:00:00Z",
  recurrence_rule_id: "rule-1",
  drive_folder_url: "https://drive.google.com/drive/folders/abc",
  overdue_notified_at: "2026-11-08T10:00:00Z",
  task_number: 123,
};

describe("buildClonedTaskRow", () => {
  const row = buildClonedTaskRow(source, { title: "Feed - Aura Matra (cópia)", parentTaskId: null, position: 3, createdBy: "user-new" });

  it("carries everything the side column shows", () => {
    expect(row).toMatchObject({
      account_id: "acc-1",
      board_id: "board-1",
      stage_id: "stage-1",
      contact_id: "contact-1",
      sector_id: "sector-1",
      project_id: "project-1",
      deal_id: "deal-1",
      assignee_id: "profile-1",
      priority: "high",
      is_urgent: true,
      start_date: "2026-11-06",
      due_date: "2026-11-06",
      estimated_minutes: 90,
      drive_folder_url: "https://drive.google.com/drive/folders/abc",
      briefing: { type: "doc", content: [] },
    });
  });

  it("copies every listed column from the source", () => {
    for (const column of CLONED_TASK_COLUMNS) {
      expect(row[column]).toEqual((source as Record<string, unknown>)[column]);
    }
  });

  it("sets what is new for the copy", () => {
    expect(row.title).toBe("Feed - Aura Matra (cópia)");
    expect(row.parent_task_id).toBeNull();
    expect(row.position).toBe(3);
    expect(row.created_by).toBe("user-new");
  });

  it("does not carry the identity or the history of the old task", () => {
    for (const column of ["id", "task_number", "status", "completed_at", "created_at", "updated_at", "overdue_notified_at", "recurrence_rule_id"]) {
      expect(row).not.toHaveProperty(column);
    }
  });

  it("keeps a copied subtask under the given parent", () => {
    const sub = buildClonedTaskRow(source, { title: "x", parentTaskId: "parent-9", position: 0, createdBy: "u" });
    expect(sub.parent_task_id).toBe("parent-9");
  });
});
