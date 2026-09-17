"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { useEditor, EditorContent, type Content, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import type { RichDoc } from "@/lib/types";

const EMPTY_DOC: RichDoc = { type: "doc", content: [] };

/** What the editor holds right now. */
export type EditorRead = {
  doc: RichDoc;
  /** False while the document is exactly what the editor was seeded with. */
  changed: boolean;
};

/**
 * The rich-text body editor. It never saves anything itself (KANBAN-42): it
 * reports its document to the caller's draft, and the caller saves once when
 * editing finishes. `value` seeds it once; to load different content (e.g.
 * restoring a draft), remount it with a new `key`.
 */
export function RichTextEditor({
  value,
  onChange,
  onUploadImage,
  autoFocus = false,
  readRef,
  contentClassName = "prose-mykan min-h-40 max-h-[60vh] overflow-y-auto px-3 py-2 outline-none",
}: {
  value: RichDoc | null;
  /**
   * Fired shortly after the document changes (debounced ~250ms), for the
   * caller's local draft only. `changed` compares against the seeded document
   * as the editor normalised it, so opening and closing without an edit never
   * reads as a change.
   */
  onChange: (read: EditorRead) => void;
  /** Uploads a pasted/dropped image and resolves to its served URL. */
  onUploadImage: (file: File) => Promise<string>;
  autoFocus?: boolean;
  /**
   * Populated with a synchronous read of the current document, so the caller
   * can take the very latest text the moment editing finishes (Esc, close, page
   * hide) without waiting for the debounced `onChange`. Null while unmounted.
   */
  readRef?: MutableRefObject<(() => EditorRead) | null>;
  /**
   * Classes on the editable area. The default caps its height and scrolls
   * inside (dialogs); the card page lets its column do the scrolling instead.
   * Read once, when the editor is created.
   */
  contentClassName?: string;
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
  // The seeded document as the editor normalised it (set on create).
  const initialJson = useRef<string | null>(null);

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
        class: contentClassName,
      },
      handlePaste: (_view, event) => handleImageFiles(event.clipboardData),
      handleDrop: (_view, event) => handleImageFiles(event.dataTransfer),
    },
    onCreate: ({ editor }) => {
      initialJson.current = JSON.stringify(editor.getJSON());
    },
    onUpdate: ({ editor }) => {
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => {
        debounce.current = null;
        onChangeRef.current(readEditor(editor, initialJson.current));
      }, 250);
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

  // Expose the synchronous read.
  useEffect(() => {
    if (!readRef) return;
    readRef.current = editor ? () => readEditor(editor, initialJson.current) : null;
    return () => {
      readRef.current = null;
    };
  }, [editor, readRef]);

  // Nothing to flush on unmount: the caller reads the document when editing
  // finishes. Just drop the pending draft notification.
  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  return <EditorContent editor={editor} />;
}

function readEditor(editor: Editor, initialJson: string | null): EditorRead {
  const doc = editor.getJSON() as RichDoc;
  return { doc, changed: initialJson !== null && JSON.stringify(doc) !== initialJson };
}
