"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent, type Content, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import type { RichDoc } from "@/lib/types";

const EMPTY_DOC: RichDoc = { type: "doc", content: [] };

export function RichTextEditor({
  value,
  onChange,
  onUploadImage,
  autoFocus = false,
}: {
  value: RichDoc | null;
  /** Fired (debounced) with the latest document whenever it changes. */
  onChange: (doc: RichDoc) => void;
  /** Uploads a pasted/dropped image and resolves to its served URL. */
  onUploadImage: (file: File) => Promise<string>;
  autoFocus?: boolean;
}) {
  // Keep the latest callbacks in refs so the editor's static editorProps
  // closures always call through to current values without re-initialising.
  const onChangeRef = useRef(onChange);
  const onUploadRef = useRef(onUploadImage);
  useEffect(() => {
    onChangeRef.current = onChange;
    onUploadRef.current = onUploadImage;
  });

  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    immediatelyRender: false, // required under Next.js SSR to avoid hydration drift
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: "Write details, paste a screenshot…" }),
    ],
    content: (value ?? EMPTY_DOC) as Content,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class:
          "prose-mykan min-h-40 max-h-[60vh] overflow-y-auto px-3 py-2 outline-none",
      },
      handlePaste: (_view, event) => handleImageFiles(event.clipboardData),
      handleDrop: (_view, event) => handleImageFiles(event.dataTransfer),
    },
    onUpdate: ({ editor }) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        onChangeRef.current(editor.getJSON() as RichDoc);
      }, 700);
    },
  });

  function handleImageFiles(dt: DataTransfer | null): boolean {
    const files = Array.from(dt?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0 || !editor) return false;
    for (const file of files) void insertImage(editor, file);
    return true; // we handled it; stop default paste/drop
  }

  async function insertImage(ed: Editor, file: File) {
    try {
      const url = await onUploadRef.current(file);
      ed.chain().focus().setImage({ src: url }).run();
    } catch {
      // Swallow — the modal surfaces upload errors via its own state.
    }
  }

  // Flush any pending debounced save when unmounting (e.g. modal close).
  useEffect(() => {
    return () => {
      if (debounce.current) {
        clearTimeout(debounce.current);
        if (editor) onChangeRef.current(editor.getJSON() as RichDoc);
      }
    };
  }, [editor]);

  return <EditorContent editor={editor} />;
}
