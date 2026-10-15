"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Building2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { officeContextPhase, stopOfficeFrameMedia } from "@/lib/office/context-status";

export function OfficeFrame({ userId, accountId }: { userId: string; accountId: string }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const { user, loading, accountId: currentAccountId, profileLoading } = useAuth();
  const [phase, setPhase] = useState<"opening" | "ready" | "expired" | "unavailable">("opening");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === "aureon-office-ready") setPhase("ready");
      if (event.data?.type === "aureon-office-session-ended") setPhase("expired");
      if (event.data?.type === "aureon-office-unavailable") setPhase("unavailable");
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function verify() {
      try {
        const response = await fetch("/api/office/context", {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const body: unknown = response.status === 503 ? await response.json().catch(() => null) : null;
        const nextPhase = officeContextPhase(response.status, body);
        if (active && nextPhase) {
          stopOfficeFrameMedia(iframe.current?.contentWindow);
          setPhase(nextPhase);
        }
      } catch {
        // A temporary network failure must not masquerade as revoked membership.
      }
    }
    const interval = window.setInterval(verify, 15_000);
    window.addEventListener("focus", verify);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", verify);
    };
  }, []);

  const identityChanged = (!loading && user?.id !== userId) ||
    (!profileLoading && currentAccountId !== accountId);
  const expired = phase === "expired" || identityChanged;
  if (expired || phase === "unavailable") {
    return (
      <section className="mx-auto max-w-2xl space-y-6 py-8">
        <Alert>
          <Building2 aria-hidden="true" />
          <AlertTitle>{expired ? "Sua sessão do escritório foi encerrada" : "O escritório está indisponível"}</AlertTitle>
          <AlertDescription>
            {expired ? "Entre novamente pelo CRM para voltar ao escritório."
              : "Não conseguimos abrir o espaço agora. Tente novamente em alguns instantes."}
          </AlertDescription>
        </Alert>
        {expired ? (
          <Link href="/login?next=%2Fescritorio" className={buttonVariants()}>Entrar pelo CRM</Link>
        ) : (
          <button type="button" className={buttonVariants()} onClick={() => {
            setAttempt(value => value + 1); setPhase("opening");
          }}>Tentar novamente</button>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Escritório Aureon</h1>
        {phase === "opening" && <p className="text-muted-foreground text-sm" role="status">Abrindo escritório…</p>}
      </header>
      <iframe
        key={attempt}
        ref={iframe}
        title="Escritório virtual Aureon"
        src="/api/office/runtime/"
        allow="camera 'self'; microphone 'self'; display-capture 'self'; autoplay 'self'; fullscreen 'self'"
        className="bg-background min-h-[72vh] w-full flex-1 rounded-lg border"
        onLoad={() => {
          const documentType = iframe.current?.contentDocument?.contentType;
          if (documentType && documentType !== "text/html") setPhase("unavailable");
        }}
        onError={() => setPhase("unavailable")}
      />
    </section>
  );
}
