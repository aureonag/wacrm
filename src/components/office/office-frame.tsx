"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Building2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { officeContextPhase, stopOfficeFrameMedia } from "@/lib/office/context-status";

type OfficePhase = "opening" | "ready" | "expired" | "unavailable";

export function OfficeFrame({ userId, accountId }: { userId: string; accountId: string }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const { user, loading, accountId: currentAccountId, profileLoading } = useAuth();
  const [phase, setPhase] = useState<OfficePhase>("opening");
  const [attempt, setAttempt] = useState(0);

  const lifecycle = useRef<{ active: boolean; attempt: number; phase: OfficePhase; target: Window | null }>({
    active: false, attempt: 0, phase: "opening", target: null,
  });
  const identityChanged = (!loading && user?.id !== userId) ||
    (!profileLoading && currentAccountId !== accountId);

  // Keep revocation sticky even if auth briefly returns to the previous identity.
  if (identityChanged && phase !== "expired") setPhase("expired");

  const transition = useCallback((next: Exclude<OfficePhase, "opening">, expectedAttempt?: number) => {
    const current = lifecycle.current;
    if (!current.active || (expectedAttempt !== undefined && current.attempt !== expectedAttempt)) return;
    // A failed attempt stays closed until retry; an expired session never revives.
    if (current.phase === "expired" || (current.phase === "unavailable" && next !== "expired")) return;
    if (next === "ready" && current.phase !== "opening") return;
    if (next !== "ready") stopOfficeFrameMedia(current.target);
    current.phase = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    const current = lifecycle.current;
    const target = iframe.current?.contentWindow ?? null;
    current.active = true;
    current.target = target;
    return () => {
      current.active = false;
      current.target = null;
      stopOfficeFrameMedia(target);
    };
  }, [attempt]);

  useEffect(() => {
    if (!identityChanged) return;
    lifecycle.current.phase = "expired";
    stopOfficeFrameMedia(lifecycle.current.target);
  }, [identityChanged]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === "aureon-office-ready") transition("ready", attempt);
      if (event.data?.type === "aureon-office-session-ended") transition("expired", attempt);
      if (event.data?.type === "aureon-office-unavailable") transition("unavailable", attempt);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [attempt, transition]);

  useEffect(() => {
    if (phase !== "opening" || identityChanged) return;
    const deadline = window.setTimeout(() => {
      if (lifecycle.current.phase === "opening") transition("unavailable", attempt);
    }, 90_000);
    return () => window.clearTimeout(deadline);
  }, [attempt, phase, identityChanged, transition]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function verify() {
      const verifiedAttempt = lifecycle.current.attempt;
      try {
        const response = await fetch("/api/office/context", {
          credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        const body: unknown = response.status === 503 ? await response.json().catch(() => null) : null;
        const nextPhase = officeContextPhase(response.status, body);
        if (active && nextPhase) {
          // Revocation applies across retries; an old rollback response does not.
          transition(nextPhase, nextPhase === "expired" ? undefined : verifiedAttempt);
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
  }, [transition]);

  const expired = phase === "expired" || identityChanged;
  if (expired || phase === "unavailable") {
    return (
      <section className="mx-auto min-h-0 max-w-2xl space-y-6 overflow-y-auto py-8">
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
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={buttonVariants()} onClick={() => {
              const current = lifecycle.current;
              if (!current.active || current.phase !== "unavailable") return;
              current.attempt += 1;
              current.phase = "opening";
              setAttempt(current.attempt);
              setPhase("opening");
            }}>Tentar novamente</button>
            <a href="/api/office/runtime/index.html" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>Abrir em tela cheia</a>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex shrink-0 items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Escritório Aureon</h1>
        <div className="flex items-center gap-3">
          {phase === "opening" && <p className="text-muted-foreground text-sm" role="status">Abrindo escritório…</p>}
          <a href="/api/office/runtime/index.html" target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>Abrir em tela cheia</a>
        </div>
      </header>
      <iframe
        key={attempt}
        ref={iframe}
        title="Escritório virtual Aureon"
        src="/api/office/runtime/index.html"
        allow="camera 'self'; microphone 'self'; display-capture 'self'; autoplay 'self'; fullscreen 'self'"
        className="bg-background min-h-0 w-full flex-1 rounded-lg border"
        onLoad={() => {
          const documentType = iframe.current?.contentDocument?.contentType;
          if (documentType && documentType !== "text/html") transition("unavailable", attempt);
        }}
        onError={() => transition("unavailable", attempt)}
      />
    </section>
  );
}
