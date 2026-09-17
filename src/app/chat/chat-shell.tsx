"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { ChatSidebar } from "@/components/layout/chat-sidebar";
import { Header } from "@/components/layout/header";
import { AccountAccessAlert } from "@/components/layout/account-access-alert";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";

// Mirrors src/app/financeiro/financeiro-shell.tsx, but with NO
// environment/owner access check beyond being signed in — Chat
// (migration 084) is deliberately open to every account member,
// unlike Financeiro (owner-only) or Operational (cargo-gated).

function ChatShellInner({ children }: { children: React.ReactNode }) {
  const { user, loading, accountStatus } = useAuth();
  const router = useRouter();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

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

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <PresenceHeartbeat />
      <ChatSidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        <AccountAccessAlert />
        {children}
      </div>
    </div>
  );
}

export function ChatShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ChatShellInner>{children}</ChatShellInner>
    </AuthProvider>
  );
}
