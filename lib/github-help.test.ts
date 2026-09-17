// GitHub setup help content (KANBAN-28). Pure: guards the one content source
// the "?" dialog renders from.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GITHUB_HELP_SECTIONS,
  GITHUB_NEW_TOKEN_PREFILLED_URL,
  GITHUB_NEW_TOKEN_URL,
  GITHUB_PAT_DOCS_URL,
  GITHUB_REQUIRED_PERMISSIONS,
  helpLinks,
} from "./github-help.ts";

test("permissions are exactly Metadata read and Issues read/write", () => {
  assert.deepEqual(
    GITHUB_REQUIRED_PERMISSIONS.map((p) => [p.name, p.access]),
    [
      ["Metadata", "Read-only"],
      ["Issues", "Read and write"],
    ],
  );
});

test("the pre-filled token link asks for issues:write and nothing else", () => {
  const u = new URL(GITHUB_NEW_TOKEN_PREFILLED_URL);
  assert.equal(`${u.origin}${u.pathname}`, GITHUB_NEW_TOKEN_URL);
  assert.equal(u.searchParams.get("issues"), "write");
  assert.ok((u.searchParams.get("name") ?? "").length <= 40, "GitHub caps names at 40");
  assert.ok((u.searchParams.get("description") ?? "").length <= 1024);
  const extra = [...u.searchParams.keys()].filter(
    (k) => !["name", "description", "issues"].includes(k),
  );
  assert.deepEqual(extra, []);
});

test("every external link is https to GitHub", () => {
  const links = [...helpLinks(), GITHUB_PAT_DOCS_URL];
  assert.ok(links.length > 0);
  for (const href of links) {
    const u = new URL(href);
    assert.equal(u.protocol, "https:", href);
    assert.ok(["github.com", "docs.github.com"].includes(u.hostname), href);
  }
});

test("covers the known confusion points", () => {
  const text = JSON.stringify(GITHUB_HELP_SECTIONS);
  for (const needle of [
    "OAuth Apps",
    "fine-grained",
    "pending",
    "needs reconnect",
    "Resource owner",
    "Expiration",
  ]) {
    assert.ok(text.includes(needle), needle);
  }
});

test("section ids are unique and nothing looks like a token", () => {
  const ids = GITHUB_HELP_SECTIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(JSON.stringify(GITHUB_HELP_SECTIONS), /github_pat_|ghp_/);
});
