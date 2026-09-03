"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useHasEnvironmentAccess } from "@/hooks/use-permissions";
import { OperationalSidebar } from "@/components/layout/operational-sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Mirrors src/app/(dashboard)/dashboard-shell.tsx, plus one extra guard:
// entry to /operational requires the caller's cargo to grant the
// "operational" environment (owner always does). This is the real
// enforcement — hitting the URL directly without access redirects to
// /dashboard, it isn't just hidden from the nav.

function OperationalShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, accountStatus } = useAuth();
  const hasOperationalAccess = useHasEnvironmentAccess("operational");
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (accountStatus === "ready" && !hasOperationalAccess) {
      router.push("/dashboard");
    }
  }, [accountStatus, hasOperationalAccess, router]);

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

  if (!user || (accountStatus === "ready" && !hasOperationalAccess)) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresenceHeartbeat />
      <OperationalSidebar open={sidebarOpen} onClose={closeSidebar} />
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

export function OperationalShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <OperationalShellInner>{children}</OperationalShellInner>
    </AuthProvider>
  );
}
