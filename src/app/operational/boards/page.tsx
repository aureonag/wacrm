"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { loadBoards } from "@/lib/tasks/queries";
import { useHasPermission } from "@/hooks/use-permissions";
import type { Board } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LayoutGrid, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function BoardsPage() {
  const t = useTranslations("Operational.boards");
  const supabase = createClient();
  const canCreateBoards = useHasPermission("operational", "tasks", "create_boards");

  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setBoards(await loadBoards(supabase));
    setLoading(false);
  }, [supabase]);

  // Inline IIFE (not a bare call to `reload`) with a `cancelled` guard —
  // same idiom as PipelinesPage's initial-load effect, since a plain
  // `reload()`/`void reload()` call here trips the set-state-in-effect
  // lint rule even though the setState itself happens after an await.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadBoards(supabase);
      if (cancelled) return;
      setBoards(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/operational/boards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(t("toastFailedCreate"));
      return;
    }
    setCreateOpen(false);
    setName("");
    reload();
    toast.success(t("toastCreated"));
  }

  if (loading) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canCreateBoards && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t("newBoard")}
          </Button>
        )}
      </div>

      {boards.length === 0 ? (
        <EmptyState icon={LayoutGrid} title={t("emptyTitle")} hint={t("emptyHint")} className="min-h-64" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.map((board) => (
            <Link
              key={board.id}
              href={`/operational/boards/${board.id}`}
              className="rounded-xl border border-border bg-card/60 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-primary" />
                <h3 className="font-semibold text-foreground">{board.name}</h3>
              </div>
              {board.description && (
                <p className="mt-1 truncate text-xs text-muted-foreground">{board.description}</p>
              )}
            </Link>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm bg-popover border-border">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t("newBoard")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label className="text-muted-foreground">{t("boardName")}</Label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="border-border bg-muted text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="border-border bg-transparent text-muted-foreground hover:bg-muted">
              {t("cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={saving || !name.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving ? t("saving") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
