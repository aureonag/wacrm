"use client";

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeAdVideoPreview } from "@/lib/reportei/ad-table";

export function AdVideoPreview({ endpoint, name, poster }: { endpoint: string; name: string; poster: string }) {
  const [state, setState] = useState<{ kind: "idle" | "loading" | "error" } | { kind: "ready"; url: string }>({ kind: "idle" });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function play() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "loading" });
    try {
      const r = await fetch(endpoint, { cache: "no-store", credentials: "same-origin", signal: controller.signal });
      const body = await r.json();
      const url = r.ok ? safeAdVideoPreview(body.url) : null;
      if (!url) throw new Error("Preview unavailable");
      if (!controller.signal.aborted) setState({ kind: "ready", url });
    } catch { if (!controller.signal.aborted) setState({ kind: "error" }); }
  }

  if (state.kind === "ready") return <iframe title={`Vídeo do anúncio ${name}`} src={state.url} sandbox="allow-scripts allow-same-origin allow-forms" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="no-referrer" className="h-[65dvh] min-h-80 w-full rounded-md border-0 bg-background" />;
  return <div className="flex flex-col items-center gap-3">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={poster} alt="Prévia do vídeo" referrerPolicy="no-referrer" className="max-h-64 max-w-full rounded-md object-contain" />
    {state.kind === "error" && <p role="status" className="text-center text-sm text-muted-foreground">A Meta não disponibilizou este vídeo agora. Tente novamente ou atualize os dados do dashboard.</p>}
    <Button type="button" disabled={state.kind === "loading"} onClick={() => void play()}><Play aria-hidden />{state.kind === "loading" ? "Carregando vídeo…" : state.kind === "error" ? "Tentar novamente" : "Reproduzir vídeo"}</Button>
  </div>;
}
