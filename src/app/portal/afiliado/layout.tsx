"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/portal/afiliado", key: "campaigns", exact: true },
  { href: "/portal/afiliado/comissoes", key: "commissions", exact: false },
  { href: "/portal/afiliado/perfil", key: "profile", exact: false },
] as const;

export default function AffiliatePortalLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("Portal.nav");
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/portal/entrar");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img src="/brand/aureon-logo-white.png" alt="Aureon" className="aureon-logo aureon-logo--dark h-6 w-auto" />
            <img src="/brand/aureon-logo-black.png" alt="Aureon" className="aureon-logo aureon-logo--light h-6 w-auto" />
            <span className="hidden text-sm text-muted-foreground sm:inline">{t("title")}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            {t("signOut")}
          </Button>
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 px-4 pb-2" aria-label={t("title")}>
          {TABS.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {t(tab.key)}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6">{children}</main>
    </div>
  );
}
