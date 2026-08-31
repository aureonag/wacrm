"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";

// Lands here from Supabase auth emails (password recovery, email
// confirmation) after their hosted /auth/v1/verify redirect. Two
// delivery shapes to handle:
//
//   - PKCE: a `?code=` query param — exchange it for a session
//     server-side... except we're a client component, so we do it
//     here with the browser client instead (simpler than a route
//     handler + cookie dance, and this page has no other job).
//   - Implicit: tokens in the URL hash fragment — invisible to the
//     server, but the browser Supabase client's default
//     `detectSessionInUrl: true` already parsed it by the time this
//     component mounts, so there's nothing left to do for that case.
//
// Either way, once a session exists we forward to `next` (defaults
// to /dashboard) — for the password-recovery flow that's
// /reset-password.
function AuthCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get("next") || "/dashboard";
    const code = searchParams.get("code");
    const supabase = createClient();

    (async () => {
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
      }
      router.replace(next);
    })();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <AuthCallbackInner />
    </Suspense>
  );
}
