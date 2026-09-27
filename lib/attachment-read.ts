// Reading a card's attachments over MCP (KANBAN-54). Picks the attachment an
// agent asked for and decides how its bytes come back: an image block the
// model can see, plain text, or metadata only.
//
// Pure: no database, no storage, so every rule here runs under `node --test`.
// The download itself lives in items-core (getItemAttachment).

import type { Attachment } from "@/lib/types";

/** Image types the model can view inline; anything else isn't sent as an image. */
export const VIEWABLE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/**
 * Per-attachment ceilings, so one file can't flood the response. Images are
 * capped at 3 MB because they go out base64-encoded (about 1.33x) inside the
 * JSON-RPC reply, and a Vercel function response tops out at 4.5 MB.
 */
export const MAX_ATTACHMENT_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_BYTES = 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_CHARS = 100_000;

export type AttachmentKind = "image" | "text" | "binary";

const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/typescript",
  "application/sql",
  "application/x-sh",
  "image/svg+xml",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "log", "yaml", "yml", "xml",
  "svg", "html", "css", "js", "ts", "tsx", "jsx", "sql", "sh", "toml", "ini",
]);

function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** How an attachment is returned, from its stored content type (or, failing that, its name). */
export function attachmentKind(contentType: string, name: string): AttachmentKind {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  if ((VIEWABLE_IMAGE_TYPES as readonly string[]).includes(type)) return "image";
  if (type.startsWith("text/") || TEXT_TYPES.has(type)) return "text";
  if (!type || type === "application/octet-stream") {
    const ext = extensionOf(name);
    if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
    if (TEXT_EXTENSIONS.has(ext)) return "text";
  }
  return "binary";
}

/** The MIME type to send an image block as, when the stored type is missing. */
export function imageMimeType(contentType: string, name: string): string {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  if ((VIEWABLE_IMAGE_TYPES as readonly string[]).includes(type)) return type;
  const ext = extensionOf(name);
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
}

export type FindAttachmentResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

/**
 * Find the attachment an agent asked for: by id, then by exact file name, then
 * by file name ignoring case. A name shared by several attachments is refused
 * with their ids, rather than guessing.
 */
export function findAttachment(list: Attachment[], ref: string): FindAttachmentResult {
  const want = String(ref ?? "").trim();
  const listing = () =>
    list.length === 0
      ? "This card has no attachments."
      : `Attachments on this card: ${list.map((a) => `${a.name} (id ${a.id})`).join(", ")}.`;
  if (!want) return { ok: false, error: `No attachment given. ${listing()}` };

  const byId = list.find((a) => a.id === want);
  if (byId) return { ok: true, attachment: byId };

  for (const match of [
    (a: Attachment) => a.name === want,
    (a: Attachment) => a.name.toLowerCase() === want.toLowerCase(),
  ]) {
    const hits = list.filter(match);
    if (hits.length === 1) return { ok: true, attachment: hits[0] };
    if (hits.length > 1) {
      return {
        ok: false,
        error: `${hits.length} attachments are named "${want}"; pass one of their ids: ${hits
          .map((a) => a.id)
          .join(", ")}.`,
      };
    }
  }
  return { ok: false, error: `Attachment not found: ${want}. ${listing()}` };
}

/** Whether an attachment is too big to return, judged before downloading it. */
export function overCap(kind: AttachmentKind, size: number): number | null {
  if (kind === "image" && size > MAX_ATTACHMENT_IMAGE_BYTES) return MAX_ATTACHMENT_IMAGE_BYTES;
  if (kind === "text" && size > MAX_ATTACHMENT_TEXT_BYTES) return MAX_ATTACHMENT_TEXT_BYTES;
  return null;
}
