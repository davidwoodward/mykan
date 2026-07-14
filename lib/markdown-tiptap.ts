import type { RichDoc } from "@/lib/types";

/**
 * A deliberately BASIC markdown → Tiptap/ProseMirror converter for imported
 * GitHub issues (KANBAN-23 / GH-4). Per docs/github-integration.md §Import the
 * v1 goal is paragraphs and lists, not full markdown fidelity — the item name is
 * computed from the first body line anyway, and rich fidelity is explicitly
 * deferred. It targets only nodes the editor's StarterKit understands:
 * paragraph, heading, bulletList/orderedList/listItem, blockquote, codeBlock,
 * plus the inline marks bold / italic / code / link. Anything it doesn't
 * recognise falls back to plain text, so no malformed node ever reaches the DB.
 *
 * Pure and dependency-free (no markdown lib) — keeps the surface small and the
 * failure mode boring.
 */

type TextNode = { type: "text"; text: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
type HardBreak = { type: "hardBreak" };
type Inline = TextNode | HardBreak;
type Node = { type: string; attrs?: Record<string, unknown>; content?: unknown[] };

const BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const FENCE_RE = /^\s*```(.*)$/;

/** Build a `{type:"text"}` node, attaching marks when present. */
function text(value: string, marks?: TextNode["marks"]): TextNode {
  return marks && marks.length ? { type: "text", text: value, marks } : { type: "text", text: value };
}

/**
 * Parse the inline markdown in one line into text nodes with marks. Handles
 * `**bold**`, `*italic*` / `_italic_`, `` `code` ``, and `[label](url)`. Order
 * matters: code spans first (their contents are literal), then links, then
 * bold before italic. Unmatched markers stay as literal text.
 */
function parseInline(input: string): TextNode[] {
  const out: TextNode[] = [];
  let rest = input;
  // A single regex alternation, scanned left to right; the earliest match wins.
  const token =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/;
  while (rest) {
    const m = token.exec(rest);
    if (!m) {
      out.push(text(rest));
      break;
    }
    if (m.index > 0) out.push(text(rest.slice(0, m.index)));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(text(tok.slice(1, -1), [{ type: "code" }]));
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(text(tok.slice(2, -2), [{ type: "bold" }]));
    } else if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (link) out.push(text(link[1], [{ type: "link", attrs: { href: link[2] } }]));
      else out.push(text(tok));
    } else {
      out.push(text(tok.slice(1, -1), [{ type: "italic" }]));
    }
    rest = rest.slice(m.index + tok.length);
  }
  // Collapse to a single empty text guard so a blank inline never yields [].
  return out.length ? out : [];
}

/** A paragraph whose inline content is `line` (empty content for a blank line). */
function paragraph(line: string): Node {
  const inline = parseInline(line);
  return { type: "paragraph", content: inline };
}

/** listItem wrapping one paragraph of `line`. */
function listItem(line: string): Node {
  return { type: "listItem", content: [paragraph(line)] };
}

/**
 * Convert a markdown string into a Tiptap document. Groups consecutive lines of
 * the same kind (list items, quote lines, code fences) into one block; blank
 * lines separate paragraphs. Consecutive plain text lines join into one
 * paragraph with hard breaks, preserving the line structure the author typed.
 */
export function markdownToTiptap(md: string): RichDoc {
  const src = (md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = src.split("\n");
  const content: Node[] = [];

  // Buffer of consecutive plain-text lines, flushed as one paragraph.
  let para: string[] = [];
  const flushPara = () => {
    if (!para.length) return;
    const inline: Inline[] = [];
    para.forEach((line, i) => {
      if (i > 0) inline.push({ type: "hardBreak" });
      inline.push(...parseInline(line));
    });
    content.push({ type: "paragraph", content: inline });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block: consume until the closing fence (contents kept literal).
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1].trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i++]);
      content.push({
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: body.length ? [{ type: "text", text: body.join("\n") }] : [],
      });
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      });
      continue;
    }

    // Bullet list: gather all consecutive bullet lines.
    if (BULLET_RE.test(line)) {
      flushPara();
      const items: Node[] = [];
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        items.push(listItem((BULLET_RE.exec(lines[i]) as RegExpExecArray)[1]));
        i++;
      }
      i--; // step back; the for-loop re-increments
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list: gather all consecutive numbered lines.
    if (ORDERED_RE.test(line)) {
      flushPara();
      const items: Node[] = [];
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        items.push(listItem((ORDERED_RE.exec(lines[i]) as RegExpExecArray)[1]));
        i++;
      }
      i--;
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Blockquote: gather all consecutive quote lines into one paragraph.
    if (QUOTE_RE.test(line)) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push((QUOTE_RE.exec(lines[i]) as RegExpExecArray)[1]);
        i++;
      }
      i--;
      const inline: Inline[] = [];
      quoted.forEach((q, idx) => {
        if (idx > 0) inline.push({ type: "hardBreak" });
        inline.push(...parseInline(q));
      });
      content.push({ type: "blockquote", content: [{ type: "paragraph", content: inline }] });
      continue;
    }

    // Plain text — buffer it (joined with the next text lines into a paragraph).
    para.push(line);
  }
  flushPara();

  return { type: "doc", content };
}

/**
 * Build the body for an imported issue: the issue title as the first line (it
 * becomes the item's computed name), followed by the markdown body converted to
 * Tiptap. A blank/absent body yields just the title paragraph.
 */
export function githubIssueBody(title: string, body: string | null | undefined): RichDoc {
  const titleLine = (title ?? "").trim() || "(untitled issue)";
  const bodyDoc = markdownToTiptap((body ?? "").trim());
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: titleLine }] },
      ...(Array.isArray(bodyDoc.content) ? bodyDoc.content : []),
    ],
  };
}
