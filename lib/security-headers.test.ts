import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import nextConfig from "../next.config.ts";
import {
  SIMPLE_SECURITY_HEADERS,
  STATIC_CSP,
  STATIC_CSP_PATHS,
  buildCsp,
  makeNonce,
  originOf,
} from "./security-headers.ts";
import { PROXY_MATCHER } from "./proxy-matcher.ts";

const directives = (csp: string) =>
  new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );

test("the production CSP nonces scripts, forbids framing, and has no unsafe script source", () => {
  const d = directives(buildCsp("abc123==", false));
  assert.deepEqual(d.get("script-src"), ["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  assert.deepEqual(d.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(d.get("object-src"), ["'none'"]);
  assert.deepEqual(d.get("base-uri"), ["'self'"]);
  assert.deepEqual(d.get("default-src"), ["'self'"]);
  assert.deepEqual(d.get("connect-src"), ["'self'"]);
  assert.deepEqual(d.get("form-action"), ["'self'", "https://accounts.google.com"]);
  assert.ok(d.has("upgrade-insecure-requests"));
  const csp = buildCsp("abc123==", false);
  assert.ok(!csp.includes("unsafe-eval"), "no eval in production");
  assert.ok(!d.get("script-src")!.includes("'unsafe-inline'"));
});

/**
 * An attachment upload PUTs straight to a Supabase Storage signed URL from the
 * browser, so connect-src must carry the Supabase origin (and only its origin).
 */
test("connect-src carries the Supabase origin when it is configured", () => {
  const origins = originOf("https://abc.supabase.co/");
  assert.deepEqual(origins, ["https://abc.supabase.co"]);
  assert.deepEqual(directives(buildCsp("n", false, origins)).get("connect-src"), [
    "'self'",
    "https://abc.supabase.co",
  ]);
});

test("an unset or malformed Supabase URL leaves connect-src at 'self' and never throws", () => {
  for (const v of [undefined, "", "not a url", "javascript:alert(1)"]) {
    assert.deepEqual(originOf(v), [], String(v));
  }
});

test("development adds 'unsafe-eval' to script-src and nothing else changes for scripts", () => {
  const d = directives(buildCsp("n", true));
  assert.deepEqual(d.get("script-src"), ["'self'", "'nonce-n'", "'strict-dynamic'", "'unsafe-eval'"]);
  assert.ok(!d.has("upgrade-insecure-requests"));
});

/**
 * A nonce in style-src makes the browser ignore 'unsafe-inline', and React
 * style={...} attributes cannot carry one.
 */
test("style-src allows inline styles and carries no nonce", () => {
  const style = directives(buildCsp("n", false)).get("style-src")!;
  assert.ok(style.includes("'unsafe-inline'"));
  assert.ok(!style.some((v) => v.startsWith("'nonce-")));
});

test("each nonce is fresh, base64, and 128 bits", () => {
  const a = makeNonce();
  const b = makeNonce();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{22}==$/);
});

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
const rules = async () => (await nextConfig.headers!()) as HeaderRule[];

test("next.config sends every simple security header on every path", async () => {
  const all = (await rules()).find((r) => r.source === "/:path*");
  assert.ok(all, "no /:path* rule");
  const got = new Map(all.headers.map((h) => [h.key.toLowerCase(), h.value]));
  assert.equal(got.get("x-content-type-options"), "nosniff");
  assert.equal(got.get("x-frame-options"), "DENY");
  assert.equal(got.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.equal(
    got.get("permissions-policy"),
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  assert.equal(all.headers.length, SIMPLE_SECURITY_HEADERS.length);
  assert.ok(!got.has("content-security-policy"), "the page CSP is the proxy's, never global");
});

test("next.config turns off X-Powered-By", () => {
  assert.equal(nextConfig.poweredByHeader, false);
});

/**
 * A browser enforces every CSP header it receives. The static policy on a
 * proxied page would block all of its scripts, so each static path must be
 * one the proxy matcher excludes.
 */
test("the static CSP goes only on paths the proxy does not match", async () => {
  const matches = (path: string) =>
    PROXY_MATCHER.some((p) => new RegExp(`^${p}$`).test(path));
  const csp = (await rules()).filter((r) =>
    r.headers.some((h) => h.key.toLowerCase() === "content-security-policy"),
  );
  assert.deepEqual(csp.map((r) => r.source), [...STATIC_CSP_PATHS]);
  for (const r of csp) {
    assert.equal(r.headers[0].value, STATIC_CSP);
    const sample = r.source.replace("/:path*", "/callback/google");
    assert.equal(matches(sample), false, `${sample} is proxied AND gets the static CSP`);
  }
  assert.ok(directives(STATIC_CSP).get("frame-ancestors")?.includes("'none'"));
  assert.deepEqual(directives(STATIC_CSP).get("default-src"), ["'none'"]);
});

test("the root layout puts the proxy's nonce on its inline theme script", () => {
  const layout = readFileSync(
    fileURLToPath(new URL("../app/layout.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(layout, /headers\(\)\)\.get\("x-nonce"\)/);
  assert.match(layout, /<script nonce=\{nonce\}/);
});
