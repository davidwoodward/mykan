import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { buildCsp, makeNonce, originOf } from "@/lib/security-headers";
import { gateOutcome } from "@/lib/proxy-gate";

/**
 * The auth gate, plus the per-request nonce CSP (lib/security-headers.ts).
 * Ported from lobe (KANBAN-61).
 *
 * `auth` is CALLED inline with the request, never used as a wrapper
 * (`auth((req) => ...)`): next-auth runs a wrapper's handler even when the
 * `authorized` callback returned false, and skips its own redirect to
 * /signin, so the wrapper form would silently un-gate every screen.
 *
 * When the gate lets the request through, the response is rebuilt with
 * NextResponse.next({ request: { headers } }) so the page render sees
 * `x-nonce` and `content-security-policy` on its request (that is how Next
 * finds the nonce for its own scripts), and every Set-Cookie next-auth put on
 * its response (a refreshed session) is carried over. A redirect to /signin
 * is returned as next-auth built it, with the CSP added. Anything else from
 * auth() is a 500: the gate fails closed (lib/proxy-gate.ts).
 */
// next-auth's types do not spell out the inline-middleware call, but it is the
// runtime path `export { auth as proxy }` already took: a Request as the first
// argument goes straight to handleAuth with no user handler, so the
// `authorized` callback's false is the redirect to /signin.
const gate = auth as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response>;

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const nonce = makeNonce();
  const csp = buildCsp(
    nonce,
    process.env.NODE_ENV === "development",
    originOf(process.env.SUPABASE_URL),
  );

  let setCookies: string[] = [];
  let response: Response | null = null;
  const outcome = gateOutcome(await gate(request, event));
  if (outcome.kind === "fail") {
    console.error("[proxy] auth() returned no Response; refusing the request");
    response = new Response("Internal Server Error", { status: 500 });
  } else if (outcome.kind === "respond") {
    response = outcome.response;
  } else {
    setCookies = outcome.setCookies;
  }

  if (!response) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * lib/proxy-matcher.ts says what each exclusion is for. This array is
 * duplicated there, byte-for-byte, as PROXY_MATCHER, because Next statically
 * parses this file's `config.matcher` at compile time and rejects an imported
 * identifier or a re-exported config. lib/proxy-matcher.test.ts asserts the
 * two are identical. Change both together.
 */
export const config = {
  matcher: [
    "/((?!(?:api/auth|api/mcp|api/telegram|mcp|icon)(?:$|/)|apple-icon\\.png$|robots\\.txt$|\\.well-known/security\\.txt$|_next/(?:static|image)(?:$|/)|favicon\\.ico$).*)",
  ],
};
