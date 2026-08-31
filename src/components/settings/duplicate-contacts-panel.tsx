"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { Contact } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Users2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface DuplicateGroup {
  email: string;
  contacts: Contact[];
}

/**
 * Settings → Duplicate contacts. Groups contacts that share the same
 * email (case-insensitive) — the one duplicate signal available now
 * that phone is already unique per account (migration 022) — and lets
 * an admin merge each group into one contact via the `merge_contacts`
 * RPC (migration 044).
 */
export function DuplicateContactsPanel() {
  const t = useTranslations("Settings.duplicates");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [primaryChoice, setPrimaryChoice] = useState<Record<string, string>>({});
  const [mergingKey, setMergingKey] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("contacts")
      .select("*")
      .not("email", "is", null)
      .order("created_at", { ascending: true });

    const byEmail = new Map<string, Contact[]>();
    for (const c of (data ?? []) as Contact[]) {
      const key = (c.email ?? "").trim().toLowerCase();
      if (!key) continue;
      const bucket = byEmail.get(key) ?? [];
      bucket.push(c);
      byEmail.set(key, bucket);
    }

    const found: DuplicateGroup[] = [];
    const defaults: Record<string, string> = {};
    for (const [email, contacts] of byEmail) {
      if (contacts.length < 2) continue;
      found.push({ email, contacts });
      defaults[email] = contacts[0].id; // oldest, since the query is ordered by created_at
    }
    setGroups(found);
    setPrimaryChoice((prev) => ({ ...defaults, ...prev }));
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchGroups();
    }
  }, [accountId, fetchGroups]);

  async function handleMerge(group: DuplicateGroup) {
    const primaryId = primaryChoice[group.email] ?? group.contacts[0].id;
    const secondaries = group.contacts.filter((c) => c.id !== primaryId);
    setMergingKey(group.email);
    for (const secondary of secondaries) {
      const { error } = await supabase.rpc("merge_contacts", {
        p_primary_id: primaryId,
        p_secondary_id: secondary.id,
      });
      if (error) {
        toast.error(t("toastFailedMerge"));
        setMergingKey(null);
        await fetchGroups();
        return;
      }
    }
    setMergingKey(null);
    toast.success(t("toastMerged"));
    await fetchGroups();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <Users2 className="size-4 text-primary" />
          {t("title")}
        </CardTitle>
        <CardDescription className="text-muted-foreground">{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-4">
            {groups.map((group) => (
              <li key={group.email} className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs text-muted-foreground">{group.email}</p>
                <div className="space-y-1.5">
                  {group.contacts.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`primary-${group.email}`}
                        checked={primaryChoice[group.email] === c.id}
                        onChange={() => setPrimaryChoice((prev) => ({ ...prev, [group.email]: c.id }))}
                        className="h-3.5 w-3.5"
                      />
                      <span className="text-foreground">{c.name || c.phone}</span>
                      <span className="text-xs text-muted-foreground">{c.phone}</span>
                    </label>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={mergingKey === group.email}
                  onClick={() => handleMerge(group)}
                >
                  {mergingKey === group.email ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    t("mergeButton")
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
