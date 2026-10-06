// GET   /api/operational/ops-projects/:id — a project with its client and its
//       tasks (stage, board, assignee, due date, overdue) and summary counts.
// PATCH /api/operational/ops-projects/:id — edit, archive or restore.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requirePermission } from "@/lib/auth/require-permission";
import { countTasks, EMPTY_COUNTS, parseProjectInput, todayInSaoPaulo, ValidationError } from "@/lib/operational/clients-projects";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "view_tasks");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const project = await ctx.supabase
      .from("ops_projects")
      .select("id, name, description, status, start_date, due_date, client_id, ops_clients(id, name, code, status)")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (project.error) {
      console.error("[GET ops-projects/:id]", project.error.message);
      return NextResponse.json({ error: "Failed to load project" }, { status: 500 });
    }
    if (!project.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const tasks = await ctx.supabase
      .from("tasks")
      .select("id, task_number, title, status, priority, is_urgent, due_date, start_date, board_id, stage_id, assignee_id")
      .eq("project_id", id)
      .is("parent_task_id", null)
      .order("created_at", { ascending: false });
    if (tasks.error) return NextResponse.json({ error: "Failed to load tasks" }, { status: 500 });
    const rows = tasks.data ?? [];

    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
    const [stages, boards, people] = await Promise.all([
      uniq(rows.map((r) => r.stage_id as string)).length
        ? ctx.supabase.from("board_stages").select("id, name").in("id", uniq(rows.map((r) => r.stage_id as string)))
        : { data: [] },
      uniq(rows.map((r) => r.board_id as string)).length
        ? ctx.supabase.from("boards").select("id, name").in("id", uniq(rows.map((r) => r.board_id as string)))
        : { data: [] },
      uniq(rows.map((r) => r.assignee_id as string | null)).length
        ? ctx.supabase.from("profiles").select("id, full_name").in("id", uniq(rows.map((r) => r.assignee_id as string | null)))
        : { data: [] },
    ]);
    const nameOf = (list: { id: string; name?: string; full_name?: string }[] | null) =>
      new Map((list ?? []).map((x) => [x.id, x.name ?? x.full_name ?? ""]));
    const stageName = nameOf(stages.data as never);
    const boardName = nameOf(boards.data as never);
    const personName = nameOf(people.data as never);

    const today = todayInSaoPaulo();
    const counts = countTasks(rows.map((t) => ({ key: id, status: t.status as string, due_date: t.due_date as string | null })), today).get(id) ?? EMPTY_COUNTS;

    const client = project.data.ops_clients as unknown as { id: string; name: string; code: string | null; status: string } | null;
    return NextResponse.json({
      project: {
        id: project.data.id,
        name: project.data.name,
        description: project.data.description,
        status: project.data.status,
        start_date: project.data.start_date,
        due_date: project.data.due_date,
      },
      client,
      counts,
      tasks: rows.map((t) => ({
        id: t.id,
        number: t.task_number,
        title: t.title,
        status: t.status,
        priority: t.priority,
        is_urgent: t.is_urgent,
        due_date: t.due_date,
        board_id: t.board_id,
        board: boardName.get(t.board_id as string) ?? "",
        stage: stageName.get(t.stage_id as string) ?? "",
        assignee: t.assignee_id ? (personName.get(t.assignee_id as string) ?? "") : "",
        overdue: t.status !== "done" && Boolean(t.due_date) && (t.due_date as string) < today,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePermission("operational", "tasks", "edit_boards");
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const input = parseProjectInput(await req.json().catch(() => null), true);
    if (Object.keys(input).length === 0) return NextResponse.json({ error: "Nada para alterar." }, { status: 400 });

    const { data, error } = await ctx.supabase
      .from("ops_projects")
      .update(input)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[PATCH ops-projects/:id]", error.message);
      return NextResponse.json({ error: "Failed to update project" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
