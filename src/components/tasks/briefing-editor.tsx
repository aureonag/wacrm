"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Bold, Italic, List, ListOrdered, LinkIcon, ImageIcon, Heading2 } from "lucide-react";
import { useTranslations } from "next-intl";

// Briefing (item 5 do pedido): texto formatado, títulos, listas, links,
// imagens — salvo como JSON nativo do Tiptap (tasks.briefing jsonb),
// não como HTML/markdown, para não precisar de um parser próprio depois.

interface BriefingEditorProps {
  content: JSONContent | null | undefined;
  editable: boolean;
  onSave: (json: JSONContent) => void;
}

export function BriefingEditor({ content, editable, onSave }: BriefingEditorProps) {
  const t = useTranslations("Operational.briefing");

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
    ],
    content: content && Object.keys(content).length > 0 ? content : "",
    editable,
    editorProps: {
      attributes: {
        // No @tailwindcss/typography plugin in this project — style the
        // handful of element types StarterKit actually produces directly,
        // rather than pulling in a whole prose plugin for one editor.
        class:
          "min-h-32 rounded-b-lg border border-t-0 border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none " +
          "[&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold " +
          "[&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_li]:my-0.5 " +
          "[&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
          "[&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_p]:my-1 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
      },
    },
    onBlur: ({ editor: e }) => {
      onSave(e.getJSON());
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  if (!editor) return null;

  function addLink() {
    const url = window.prompt(t("linkPrompt"));
    if (!url) return;
    editor!.chain().focus().setLink({ href: url }).run();
  }

  function addImage() {
    const url = window.prompt(t("imagePrompt"));
    if (!url) return;
    editor!.chain().focus().setImage({ src: url }).run();
  }

  return (
    <div>
      {editable && (
        <div className="flex flex-wrap items-center gap-1 rounded-t-lg border border-border bg-card/60 p-1.5">
          <ToolbarButton active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} label={t("bold")}>
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} label={t("italic")}>
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} label={t("heading")}>
            <Heading2 className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} label={t("bulletList")}>
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} label={t("orderedList")}>
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("link")} onClick={addLink} label={t("link")}>
            <LinkIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={false} onClick={addImage} label={t("image")}>
            <ImageIcon className="h-3.5 w-3.5" />
          </ToolbarButton>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
