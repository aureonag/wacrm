import { linkifyText } from "@/lib/text/linkify";

/** Renders free text with any http(s)/www. link turned into a clickable <a>. */
export function LinkifiedText({ text, className }: { text: string; className?: string }) {
  const parts = linkifyText(text);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        part.href ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {part.text}
          </a>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}
