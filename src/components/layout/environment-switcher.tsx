"use client";

import { useRouter } from "next/navigation";
import { Briefcase, ChevronsUpDown, Wallet, Workflow } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";

type SwitcherEnvironment = "comercial" | "operational" | "financeiro";

const ENVIRONMENT_META: Record<SwitcherEnvironment, { icon: typeof Briefcase; root: string }> = {
  comercial: { icon: Briefcase, root: "/dashboard" },
  operational: { icon: Workflow, root: "/operational/dashboard" },
  financeiro: { icon: Wallet, root: "/financeiro/dashboard" },
};

/**
 * Comercial ↔ Operacional ↔ Financeiro switcher. Comercial/Operacional
 * follow the Cargos+Permissões environment grant (migration 058) — only
 * shown when the cargo has more than one, owner always has both.
 * Financeiro is deliberately NOT part of that system: it's gated on
 * `isOwner` directly, the same hard check as the Financeiro shell/API
 * routes/RLS, so it can never become grantable to another role through
 * "Cargos e permissões" the way comercial/operational modules can.
 */
export function EnvironmentSwitcher({ current }: { current: SwitcherEnvironment }) {
  const t = useTranslations("Sidebar.environment");
  const { environments, isOwner } = useAuth();
  const router = useRouter();

  if (environments.size < 2 && !isOwner) return null;

  const CurrentIcon = ENVIRONMENT_META[current].icon;
  const visibleEnvs = (Object.keys(ENVIRONMENT_META) as SwitcherEnvironment[]).filter(
    (env) => env !== "financeiro" || isOwner,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none">
        <CurrentIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{t(current)}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 bg-popover text-popover-foreground ring-border">
        {visibleEnvs.map((env) => {
          const Icon = ENVIRONMENT_META[env].icon;
          return (
            <DropdownMenuItem
              key={env}
              onClick={() => {
                if (env !== current) router.push(ENVIRONMENT_META[env].root);
              }}
              className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
            >
              <Icon className="size-4" />
              {t(env)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
