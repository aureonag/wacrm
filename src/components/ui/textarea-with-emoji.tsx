"use client";

import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { EmojiButton } from "@/components/ui/emoji-popover";
import { cn } from "@/lib/utils";

/** A normal Textarea with the emoji library button in its corner. Same props as Textarea. */
export function TextareaWithEmoji({ className, ...props }: React.ComponentProps<"textarea">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    // w-full + min-w-0: inside a flex row (e.g. the comment box next to nothing) the wrapper
    // must take the whole line like the bare textarea did, not shrink to the placeholder width.
    <div className="relative w-full min-w-0">
      <Textarea ref={ref} className={cn("pr-9", className)} {...props} />
      <EmojiButton targetRef={ref} disabled={props.disabled} className="absolute bottom-1.5 right-1.5" />
    </div>
  );
}
