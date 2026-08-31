"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { DealLineItemType, ServiceCatalogItem } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/currency";

/**
 * Settings → Service catalog. Reusable mensal/pontual line-item
 * templates picked from the "Adicionar lançamento" form on a deal, so
 * reps don't retype the same service name/value every time.
 */
export function ServiceCatalogSettings() {
  const t = useTranslations("Settings.tagsAndFields");
  const supabase = createClient();
  const { user, accountId, defaultCurrency } = useAuth();

  const [items, setItems] = useState<ServiceCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [type, setType] = useState<DealLineItemType>("mensal");
  const [value, setValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("service_catalog")
      .select("*")
      .order("name");
    setItems((data as ServiceCatalogItem[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchItems();
    }
  }, [accountId, fetchItems]);

  async function handleCreate() {
    if (!name.trim() || !accountId || !user) return;
    setCreating(true);
    const { error } = await supabase.from("service_catalog").insert({
      account_id: accountId,
      name: name.trim(),
      type,
      default_value: parseFloat(value) || 0,
    });
    setCreating(false);
    if (error) {
      toast.error(t("toastCatalogFailedCreate"));
      return;
    }
    toast.success(t("toastCatalogCreated"));
    setName("");
    setValue("");
    await fetchItems();
  }

  async function handleDelete(item: ServiceCatalogItem) {
    setBusyId(item.id);
    const { error } = await supabase.from("service_catalog").delete().eq("id", item.id);
    setBusyId(null);
    if (error) {
      toast.error(t("toastCatalogFailedDelete"));
      return;
    }
    toast.success(t("toastCatalogDeleted"));
    setItems((prev) => prev.filter((i) => i.id !== item.id));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Package className="size-4 text-primary" />
          {t("catalogTitle")}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t("catalogDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder={t("catalogNamePlaceholder")}
            className="min-w-[160px] flex-1 bg-muted text-foreground"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DealLineItemType)}
            className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
          >
            <option value="mensal">Mensal</option>
            <option value="pontual">Pontual</option>
          </select>
          <Input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("catalogValuePlaceholder")}
            className="w-32 bg-muted text-foreground"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleCreate}
            disabled={creating || !name.trim()}
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {t("catalogAdd")}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("catalogEmpty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.type === "mensal" ? "Mensal" : "Pontual"} ·{" "}
                    {formatCurrency(item.default_value, defaultCurrency)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busyId === item.id}
                  onClick={() => handleDelete(item)}
                  title={t("catalogDeleteTitle")}
                  className="shrink-0 text-muted-foreground hover:text-red-400"
                >
                  {busyId === item.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
