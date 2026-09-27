// Reading card attachments over MCP (KANBAN-54): which attachment, and how it
// comes back. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_TEXT_BYTES,
  attachmentKind,
  findAttachment,
  imageMimeType,
  overCap,
} from "./attachment-read.ts";
import type { Attachment } from "./types.ts";

const att = (id: string, name: string, content_type = "image/png"): Attachment => ({
  id,
  name,
  content_type,
  size: 100,
  path: `items/x/${id}`,
});

test("attachmentKind: viewable images, text, and everything else", () => {
  assert.equal(attachmentKind("image/png", "a.png"), "image");
  assert.equal(attachmentKind("image/jpeg", "a.jpg"), "image");
  assert.equal(attachmentKind("image/webp; charset=binary", "a"), "image");
  assert.equal(attachmentKind("image/heic", "a.heic"), "binary");
  assert.equal(attachmentKind("image/svg+xml", "a.svg"), "text");
  assert.equal(attachmentKind("text/markdown", "notes.md"), "text");
  assert.equal(attachmentKind("application/json", "a.json"), "text");
  assert.equal(attachmentKind("application/pdf", "a.pdf"), "binary");
});

test("attachmentKind: falls back to the file name when the type is missing", () => {
  assert.equal(attachmentKind("", "Screenshot.PNG"), "image");
  assert.equal(attachmentKind("application/octet-stream", "log.txt"), "text");
  assert.equal(attachmentKind("application/octet-stream", "blob.bin"), "binary");
});

test("imageMimeType: stored type, else from the extension", () => {
  assert.equal(imageMimeType("image/gif", "x"), "image/gif");
  assert.equal(imageMimeType("", "x.JPG"), "image/jpeg");
  assert.equal(imageMimeType("application/octet-stream", "x.png"), "image/png");
});

test("findAttachment: by id, exact name, then name ignoring case", () => {
  const list = [att("a1", "Screenshot.png"), att("a2", "notes.md", "text/markdown")];
  assert.deepEqual(findAttachment(list, "a2"), { ok: true, attachment: list[1] });
  assert.deepEqual(findAttachment(list, "Screenshot.png"), { ok: true, attachment: list[0] });
  assert.deepEqual(findAttachment(list, " screenshot.PNG "), { ok: true, attachment: list[0] });
});

test("findAttachment: a shared name is refused with the ids, not guessed", () => {
  const list = [att("a1", "image.png"), att("a2", "image.png")];
  const r = findAttachment(list, "image.png");
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /a1, a2/);
  assert.deepEqual(findAttachment(list, "a2"), { ok: true, attachment: list[1] });
});

test("findAttachment: a miss lists what is there", () => {
  const r = findAttachment([att("a1", "one.png")], "two.png");
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /one\.png \(id a1\)/);
  const none = findAttachment([], "x");
  assert.match(!none.ok ? none.error : "", /no attachments/);
});

test("overCap: per-kind ceilings, binaries never downloaded so never capped", () => {
  assert.equal(overCap("image", MAX_ATTACHMENT_IMAGE_BYTES), null);
  assert.equal(overCap("image", MAX_ATTACHMENT_IMAGE_BYTES + 1), MAX_ATTACHMENT_IMAGE_BYTES);
  assert.equal(overCap("text", MAX_ATTACHMENT_TEXT_BYTES + 1), MAX_ATTACHMENT_TEXT_BYTES);
  assert.equal(overCap("binary", 10 ** 9), null);
});
