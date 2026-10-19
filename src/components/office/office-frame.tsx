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
  const [recovery, setRecovery] = useState<"none" | "remount" | "direct">("none");
  const openingDeadline = useRef<number | null>(null);
  const recoveryAction = useRef<"none" | "remount" | "direct">("none");

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
    // An automatic remount shares the original opening budget. Only an explicit
    // retry below starts a new budget after the failed attempt is closed.
    openingDeadline.current ??= Date.now() + 90_000;
    const deadline = window.setTimeout(() => {
      if (lifecycle.current.phase === "opening") transition("unavailable", attempt);
    }, Math.max(0, openingDeadline.current - Date.now()));
    return () => window.clearTimeout(deadline);
  }, [attempt, phase, identityChanged, transition]);

  useEffect(() => {
    if (phase !== "opening" || identityChanged || recovery === "direct") return;
    const frame = iframe.current;
    const target = frame?.contentWindow;
    const recoveryTimer = window.setTimeout(() => {
      const current = lifecycle.current;
      if (!frame || !target || !current.active || current.phase !== "opening" ||
        current.attempt !== attempt || current.target !== target || iframe.current !== frame ||
        recoveryAction.current !== recovery || openingDeadline.current === null ||
        Date.now() >= openingDeadline.current) return;
      try {
        // A committed/runtime document must be allowed to finish its own startup.
        // This is one bounded recovery of the initial blank document, not proof
        // that its pending navigation or the network has failed.
        const document = frame.contentDocument;
        if (document?.URL !== "about:blank" || document.readyState !== "complete") return;
      } catch { return; }
      stopOfficeFrameMedia(target);
      if (recovery === "none") {
        recoveryAction.current = "remount";
        current.attempt += 1;
        setRecovery("remount");
        setAttempt(current.attempt);
      } else {
        recoveryAction.current = "direct";
        setRecovery("direct");
      }
    }, 10_000);
    return () => window.clearTimeout(recoveryTimer);
  }, [attempt, phase, identityChanged, recovery]);

  useEffect(() => {
    const current = lifecycle.current;
    if (recovery !== "direct" || recoveryAction.current !== "direct" || phase !== "opening" ||
      identityChanged || !current.active || current.phase !== "opening" ||
      current.attempt !== attempt || current.target !== iframe.current?.contentWindow ||
      openingDeadline.current === null || Date.now() >= openingDeadline.current) return;
    try {
      const document = iframe.current?.contentDocument;
      if (document?.URL !== "about:blank" || document.readyState !== "complete") return;
    } catch { return; }
    // Reuse the existing authenticated, same-tab entry when embedding stayed
    // blank twice. The destination repeats the CRM membership check.
    try { window.location.assign("/api/office/runtime/index.html"); }
    catch { transition("unavailable", attempt); }
  }, [attempt, phase, identityChanged, recovery, transition]);

  useEffect(() => {
    type ContextRequest = { controller: AbortController; deadline: number | null };
    let active = true;
    let inFlight: ContextRequest | null = null;
    const owns = (request: ContextRequest) => active && inFlight === request && !request.controller.signal.aborted;
    function release(request: ContextRequest, abort = false) {
      if (request.deadline !== null) {
        window.clearTimeout(request.deadline);
        request.deadline = null;
      }
      // A timed-out request may settle after a fresh check has already started.
      if (inFlight === request) inFlight = null;
      if (abort) request.controller.abort();
    }
    async function verify() {
      if (!active || inFlight) return;
      const verifiedAttempt = lifecycle.current.attempt;
      const request: ContextRequest = { controller: new AbortController(), deadline: null };
      inFlight = request;
      request.deadline = window.setTimeout(() => release(request, true), 10_000);
      try {
        const response = await fetch("/api/office/context", {
          credentials: "same-origin", cache: "no-store", signal: request.controller.signal,
        });
        if (!owns(request)) return;
        const body: unknown = response.status === 503 ? await response.json().catch(() => null) : null;
        if (!owns(request)) return;
        const nextPhase = officeContextPhase(response.status, body);
        if (nextPhase) {
          // Revocation applies across retries; an old rollback response does not.
          transition(nextPhase, nextPhase === "expired" ? undefined : verifiedAttempt);
        }
      } catch {
        // A temporary network failure must not masquerade as revoked membership.
      } finally {
        release(request);
      }
    }
    const interval = window.setInterval(verify, 15_000);
    window.addEventListener("focus", verify);
    return () => {
      active = false;
      if (inFlight) release(inFlight, true);
      window.clearInterval(interval);
      window.removeEventListener("focus", verify);
    };
  }, [transition]);

  const expired = phase === "expired" || identityChanged;
  if (expired || phase === "unavailable") {
    return (
      <section
        data-office-frame-phase={expired ? "expired" : "unavailable"}
        data-office-frame-attempt={attempt}
        className="mx-auto min-h-0 max-w-2xl space-y-6 overflow-y-auto py-8"
      >
        <Alert>
          <Building2 aria-hidden="true" />
          <AlertTitle>{expired ? "Sua sessão do escritório foi encerrada" : "O escritório está indisponível"}</AlertTitle>
          <AlertDescription>
            {expired ? "Entre novamente pelo CRM para voltar ao escritório."
              : "Não conseguimos abrir o espaço nesta tela. Tente novamente ou abra em outra guia."}
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
              openingDeadline.current = null;
              recoveryAction.current = "none";
              setRecovery("none");
              setAttempt(current.attempt);
              setPhase("opening");
            }}>Tentar novamente</button>
            <a href="/api/office/runtime/index.html" target="_blank" rel="noopener noreferrer" title="Abre o escritório em outra guia do navegador" className={buttonVariants({ variant: "outline", size: "sm" })}>Abrir em outra guia</a>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      data-office-frame-phase={phase}
      data-office-frame-attempt={attempt}
      data-office-frame-recovery={recovery}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <header className="flex shrink-0 items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Escritório Aureon</h1>
        <div className="flex items-center gap-3">
          {phase === "opening" && <p className="text-muted-foreground text-sm" role="status">Abrindo escritório…</p>}
          <a href="/api/office/runtime/index.html" target="_blank" rel="noopener noreferrer" title="Abre o escritório em outra guia do navegador" className={buttonVariants({ variant: "outline", size: "sm" })}>Abrir em outra guia</a>
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
