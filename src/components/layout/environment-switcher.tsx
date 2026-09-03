"use client";

import { useRouter } from "next/navigation";
import { Briefcase, ChevronsUpDown, Workflow } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";

const ENVIRONMENT_META = {
  comercial: { icon: Briefcase, root: "/dashboard" },
  operational: { icon: Workflow, root: "/operational/dashboard" },
} as const;

/**
 * Comercial ↔ Operacional switcher (migration 058, ETAPA 1). Only
 * renders when the current cargo grants more than one environment —
 * owner always has both. A single-environment user never sees this at
 * all, matching the spec ("se possuir somente acesso Comercial, não deve
 * visualizar o Operacional").
 */
export function EnvironmentSwitcher({ current }: { current: "comercial" | "operational" }) {
  const t = useTranslations("Sidebar.environment");
  const { environments } = useAuth();
  const router = useRouter();

  if (environments.size < 2) return null;

  const CurrentIcon = ENVIRONMENT_META[current].icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mx-3 mb-1 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none">
        <CurrentIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate">{t(current)}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52 bg-popover text-popover-foreground ring-border">
        {(Object.keys(ENVIRONMENT_META) as Array<keyof typeof ENVIRONMENT_META>).map((env) => {
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
