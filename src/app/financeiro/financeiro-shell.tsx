"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { FinanceiroSidebar } from "@/components/layout/financeiro-sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Mirrors src/app/operational/operational-shell.tsx, but the access
// check is `isOwner` directly rather than `useHasEnvironmentAccess` —
// Financeiro is intentionally NOT part of the Cargos+Permissões
// environment grant, so there is no cargo configuration that can ever
// open this to a non-owner. Hitting /financeiro/* directly without
// being the owner redirects to /dashboard; this is real enforcement,
// not just an absent sidebar entry (the API routes + RLS enforce the
// same rule independently).

function FinanceiroShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, accountStatus, isOwner } = useAuth();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (accountStatus === "ready" && !isOwner) {
      router.push("/dashboard");
    }
  }, [accountStatus, isOwner, router]);

  if (loading || accountStatus === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user || (accountStatus === "ready" && !isOwner)) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresenceHeartbeat />
      <FinanceiroSidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <AccountAccessAlert />
          {children}
        </main>
      </div>
    </div>
  );
}

export function FinanceiroShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <FinanceiroShellInner>{children}</FinanceiroShellInner>
    </AuthProvider>
  );
}
