"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";

interface Profile {
  name: string;
  email: string;
  phone: string | null;
  instagram: string | null;
  city: string | null;
  state: string | null;
  pix_key_type: string | null;
  pix_key: string | null;
}

const PIX_TYPES = ["cpf", "cnpj", "email", "phone", "random"] as const;

export default function PortalProfilePage() {
  const t = useTranslations("Portal.profile");
  const ta = useTranslations("Operational.affiliates");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/portal/affiliate/me");
      if (cancelled) return;
      if (!res.ok) return setFailed(true);
      setProfile(((await res.json()) as { profile: Profile }).profile);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <EmptyState title={ta("error")} className="min-h-40" />;
  if (!profile) return <Skeleton className="h-64" />;

  const set = (key: keyof Profile) => (e: { target: { value: string } }) =>
    setProfile((p) => (p ? { ...p, [key]: e.target.value } : p));

  async function save() {
    if (!profile) return;
    setSaving(true);
    const res = await fetch("/api/portal/affiliate/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    setSaving(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      return toast.error(res.status === 400 ? (data?.error ?? ta("saveError")) : ta("saveError"));
    }
    toast.success(t("saved"));
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="pf-email">{t("email")}</Label>
            <Input id="pf-email" value={profile.email} disabled readOnly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">{t("name")}</Label>
            <Input id="pf-name" value={profile.name} maxLength={200} onChange={set("name")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-phone">{t("phone")}</Label>
            <Input id="pf-phone" value={profile.phone ?? ""} maxLength={40} onChange={set("phone")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-ig">{t("instagram")}</Label>
            <Input id="pf-ig" value={profile.instagram ?? ""} maxLength={100} onChange={set("instagram")} />
          </div>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-city">{t("city")}</Label>
              <Input id="pf-city" value={profile.city ?? ""} maxLength={100} onChange={set("city")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-state">{t("state")}</Label>
              <Input id="pf-state" value={profile.state ?? ""} maxLength={2} onChange={set("state")} />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("pixTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("pixHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pf-pixtype">{ta("members.fieldPixType")}</Label>
            <Select
              value={profile.pix_key_type || null}
              onValueChange={(v) => v && setProfile((p) => (p ? { ...p, pix_key_type: v } : p))}
            >
              <SelectTrigger id="pf-pixtype" className="w-full">
                <SelectValue>{profile.pix_key_type ? ta(`members.pix_${profile.pix_key_type}`) : "—"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PIX_TYPES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {ta(`members.pix_${p}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-pix">{ta("members.fieldPixKey")}</Label>
            <Input id="pf-pix" value={profile.pix_key ?? ""} maxLength={200} onChange={set("pix_key")} />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || profile.name.trim().length < 2}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("save")}
        </Button>
      </div>
    </>
  );
}
