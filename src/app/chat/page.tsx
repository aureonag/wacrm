"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ChatChannel } from "@/types";

// Landing route for /chat: redirects to the first channel the caller
// can see, or shows an empty state if the account has none yet (the
// sidebar's "+" always lets them create one).
export default function ChatIndexPage() {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/channels");
        const data = await res.json().catch(() => ({}));
        const channels: ChatChannel[] = data.channels ?? [];
        if (cancelled) return;
        if (res.ok && channels.length > 0) {
          router.replace(`/chat/${channels[0].id}`);
          return;
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!checked) return null;

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-sm text-muted-foreground">{t("empty.noChannelSelected")}</p>
    </div>
  );
}
