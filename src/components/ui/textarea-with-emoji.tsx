"use client";

import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { EmojiButton } from "@/components/ui/emoji-popover";
import { cn } from "@/lib/utils";

/** A normal Textarea with the emoji library button in its corner. Same props as Textarea. */
export function TextareaWithEmoji({ className, ...props }: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="relative">
      <Textarea ref={ref} className={cn("pr-9", className)} {...props} />
      <EmojiButton targetRef={ref} disabled={props.disabled} className="absolute bottom-1.5 right-1.5" />
    </div>
  );
}
