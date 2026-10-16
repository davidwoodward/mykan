import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gateOutcome } from "./proxy-gate.ts";

test("a next-auth pass-through passes, keeping its session cookies", () => {
  const res = new Response(null, { headers: { "x-middleware-next": "1" } });
  res.headers.append("set-cookie", "authjs.session-token=a; Path=/");
  const out = gateOutcome(res);
  assert.equal(out.kind, "pass");
  assert.deepEqual(out.kind === "pass" && out.setCookies, ["authjs.session-token=a; Path=/"]);
});

test("a next-auth redirect is returned as it is", () => {
  const res = new Response(null, { status: 307, headers: { location: "/signin" } });
  const out = gateOutcome(res);
  assert.equal(out.kind, "respond");
  assert.equal(out.kind === "respond" && out.response, res);
});

/** Fail closed: anything that is not a Response must not let the request through. */
test("anything that is not a Response fails closed", () => {
  for (const v of [null, undefined, {}, { headers: new Headers({ "x-middleware-next": "1" }) }, "ok"]) {
    assert.equal(gateOutcome(v).kind, "fail");
  }
});

/**
 * proxy.ts must call auth() INLINE (a wrapper un-gates every screen) and turn
 * an unexpected answer into a 500.
 */
test("proxy.ts gates with gateOutcome, inline, and answers a failure with 500", () => {
  const src = readFileSync(fileURLToPath(new URL("../proxy.ts", import.meta.url)), "utf8");
  assert.match(src, /gateOutcome\(await gate\(request, event\)\)/);
  assert.match(src, /status: 500/);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/auth\(\s*\(?\s*req/.test(code), "auth must not be used as a wrapper");
  assert.ok(!/export \{ auth as proxy \}/.test(code), "the bare re-export sets no CSP");
});
