import { describe, expect, it } from "vitest";
import { taskPath, taskShareUrl, whatsappShareUrl } from "./share";

describe("task share links", () => {
  const task = { board_id: "b1", id: "t1" };

  it("points to the board with the task open", () => {
    expect(taskPath(task)).toBe("/operational/boards/b1?task=t1");
  });

  it("joins origin and path without a double slash", () => {
    expect(taskShareUrl("https://aureonag.com/", task)).toBe("https://aureonag.com/operational/boards/b1?task=t1");
    expect(taskShareUrl("https://aureonag.com", task)).toBe("https://aureonag.com/operational/boards/b1?task=t1");
  });

  it("builds a WhatsApp link with the encoded message", () => {
    expect(whatsappShareUrl("Tarefa X: https://a.b/?q=1")).toBe(
      "https://wa.me/?text=Tarefa%20X%3A%20https%3A%2F%2Fa.b%2F%3Fq%3D1",
    );
  });
});
