// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROXY_MATCHER } from "./proxy-matcher.ts";

/**
 * The matcher decides which paths the auth gate intercepts (KANBAN-61).
 * Getting it wrong does not fail loudly: the MCP endpoints keep answering, but
 * with a redirect to an HTML sign-in page, and a too-broad exclusion silently
 * serves an app screen ungated.
 */
const matches = (path: string) =>
  PROXY_MATCHER.some((p) => new RegExp(`^${p}$`).test(path));

test("the gate intercepts every screen", () => {
  for (const p of ["/", "/KANBAN-61", "/projects/abc", "/signin", "/nope"]) {
    assert.equal(matches(p), true, p);
  }
});

/** They are let through by `authorized` and gate themselves, but get the CSP. */
test("the proxy runs on the self-gated /api routes", () => {
  for (const p of ["/api/items/x", "/api/projects", "/api/images/a/b.png", "/api/mcp-tokens"]) {
    assert.equal(matches(p), true, p);
  }
});

test("the gate does NOT intercept the MCP endpoints, the webhook or next-auth", () => {
  for (const p of [
    "/mcp",
    "/mcp/x",
    "/api/mcp",
    "/api/telegram",
    "/api/auth",
    "/api/auth/signin",
    "/api/auth/callback/google",
  ]) {
    assert.equal(matches(p), false, p);
  }
});

test("the gate does NOT intercept the icons, robots.txt or security.txt", () => {
  for (const p of ["/icon", "/apple-icon.png", "/robots.txt", "/.well-known/security.txt"]) {
    assert.equal(matches(p), false, p);
  }
});

test("the gate does not intercept Next's own static files", () => {
  assert.equal(matches("/favicon.ico"), false);
  assert.equal(matches("/_next/static/chunks/a.js"), false);
  assert.equal(matches("/_next/image"), false);
});

/**
 * Every exclusion is anchored. An unanchored prefix exempts any future route
 * that merely starts with the same letters, and an extension rule exempts any
 * app path that ends in one.
 */
test("a path ending in an image extension is still gated", () => {
  for (const p of ["/KANBAN-1.png", "/projects/x.svg", "/x.ico", "/next.svg"]) {
    assert.equal(matches(p), true, p);
  }
});

test("a route that only shares a prefix with an exclusion is gated", () => {
  for (const p of [
    "/icons",
    "/apple-icon",
    "/apple-icon.pngx",
    "/api/authors",
    "/api/mcp-tokens",
    "/api/telegramx",
    "/mcpx",
    "/_next/staticx",
    "/favicon.icox",
    "/robots.txt-x",
    "/.well-known/security.txt-x",
    "/.well-known/other",
  ]) {
    assert.equal(matches(p), true, p);
  }
});

/**
 * PROXY_MATCHER is a byte-for-byte copy of the literal inside proxy.ts,
 * because Next statically parses `config.matcher` at compile time and rejects
 * an imported identifier. If the two drift, every test above keeps passing
 * against a pattern the server does not use.
 */
test("the tested pattern is the one proxy.ts actually ships", () => {
  const proxySource = readFileSync(fileURLToPath(new URL("../proxy.ts", import.meta.url)), "utf8");
  for (const pattern of PROXY_MATCHER) {
    assert.ok(
      proxySource.includes(JSON.stringify(pattern)),
      `proxy.ts does not contain this pattern; lib/proxy-matcher.ts has drifted:\n  ${pattern}`,
    );
  }
});
