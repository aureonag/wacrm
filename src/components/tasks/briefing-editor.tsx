"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent, Mark, mergeAttributes, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Bold, Highlighter, Italic, List, ListOrdered, LinkIcon, ImageIcon, Heading2, SquareCheck } from "lucide-react";
import { useTranslations } from "next-intl";

// Briefing (item 5 do pedido): texto formatado, títulos, listas, links,
// imagens — salvo como JSON nativo do Tiptap (tasks.briefing jsonb),
// não como HTML/markdown, para não precisar de um parser próprio depois.
//
// Também: lista de tarefas com checkbox clicável (TaskList/TaskItem, igual a
// um documento Word) e marca-texto ("grifar"). Os dois são nós/marcas novos
// no mesmo JSON; briefings antigos continuam abrindo normalmente.

/** Marca-texto: <mark> laranja, alternado por botão ou Ctrl/Cmd+Shift+H. */
const Highlight = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },
  addKeyboardShortcuts() {
    return { "Mod-Shift-h": () => this.editor.commands.toggleMark(this.name) };
  },
});

// Checkbox/auto-save: marcar uma caixa não tira o foco do editor, então salvar
// só no blur perderia o clique se a pessoa fechasse a tarefa logo depois.
const AUTOSAVE_MS = 800;

interface BriefingEditorProps {
  content: JSONContent | null | undefined;
  editable: boolean;
  onSave: (json: JSONContent) => void;
}

export function BriefingEditor({ content, editable, onSave }: BriefingEditorProps) {
  const t = useTranslations("Operational.briefing");

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
    ],
    content: content && Object.keys(content).length > 0 ? content : "",
    editable,
    editorProps: {
      attributes: {
        spellcheck: "true",
        lang: "pt-BR",
        // No @tailwindcss/typography plugin in this project — style the
        // handful of element types StarterKit actually produces directly,
        // rather than pulling in a whole prose plugin for one editor.
        class:
          "min-h-32 rounded-b-lg border border-t-0 border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none " +
          "[&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold " +
          "[&_ul]:ml-4 [&_ul]:list-disc [&_ol]:ml-4 [&_ol]:list-decimal [&_li]:my-0.5 " +
          "[&_ul[data-type=taskList]]:ml-0 [&_ul[data-type=taskList]]:list-none [&_li[data-checked]]:flex [&_li[data-checked]]:items-start [&_li[data-checked]]:gap-2 " +
          "[&_li[data-checked]>label]:mt-[3px] [&_li[data-checked]>label]:shrink-0 [&_li[data-checked]>div]:min-w-0 [&_li[data-checked]>div]:flex-1 " +
          "[&_li[data-checked]_input]:h-4 [&_li[data-checked]_input]:w-4 [&_li[data-checked]_input]:cursor-pointer [&_li[data-checked]_input]:accent-primary " +
          "[&_mark]:rounded-sm [&_mark]:bg-orange-400/70 [&_mark]:px-0.5 [&_mark]:text-foreground " +
          "[&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
          "[&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_p]:my-1 [&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md",
      },
    },
    onUpdate: ({ editor: e }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        onSaveRef.current(e.getJSON());
      }, AUTOSAVE_MS);
    },
    onBlur: ({ editor: e }) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      onSaveRef.current(e.getJSON());
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  // Closing the task right after a click: write the pending change now.
  useEffect(() => {
    return () => {
      if (saveTimer.current && editor && !editor.isDestroyed) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        onSaveRef.current(editor.getJSON());
      }
    };
  }, [editor]);

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
          <ToolbarButton active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} label={t("taskList")}>
            <SquareCheck className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleMark("highlight").run()} label={t("highlight")}>
            <Highlighter className="h-3.5 w-3.5" />
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
