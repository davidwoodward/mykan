/**
 * Every security response header mykan sends, and the per-request CSP
 * (KANBAN-61, ported from lobe).
 *
 * PURE and dependency-free on purpose: next.config.ts and proxy.ts both read
 * it, and lib/security-headers.test.ts imports it without loading Next or
 * next-auth.
 *
 * Two CSPs, and they must never both land on one response (a browser enforces
 * EVERY CSP header it receives, so a static `default-src 'none'` stacked on
 * the nonce policy would block every script on the page):
 *
 * - `buildCsp(nonce, dev, connectOrigins)` - set by proxy.ts on every path the
 *   proxy matches, which is every HTML screen (and the self-gated /api routes,
 *   which answer JSON and ignore it). Next reads the nonce back out of the
 *   REQUEST's `content-security-policy` header and puts it on its own scripts;
 *   the root layout reads `x-nonce` for the one inline script mykan writes
 *   itself (the theme script). A nonce only works on a dynamically rendered
 *   page, and the root layout reading `headers()` makes every page dynamic.
 * - `STATIC_CSP` - set by next.config.ts on exactly the paths the proxy does
 *   NOT match and that answer something other than an app screen
 *   (`STATIC_CSP_PATHS`). They render no app scripts, so nothing needs a
 *   nonce.
 */

/** The headers every response gets, from next.config.ts on `/:path*`. */
export const SIMPLE_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // CSP frame-ancestors 'none' says the same thing to modern browsers; this
  // covers the ones (and the scanners) that only read the old header.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // mykan uses none of these (no camera, microphone, location, payment or USB
  // call anywhere in app/, components/ or lib/).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

/**
 * The enforced page policy.
 *
 * - script-src: the nonce plus 'strict-dynamic', so Next's nonced bootstrap
 *   may load its chunks and nothing else runs. 'self' is a fallback for
 *   browsers without strict-dynamic. 'unsafe-eval' ONLY in development, where
 *   React uses eval to rebuild server error stacks.
 * - style-src keeps 'unsafe-inline' and deliberately carries NO nonce: a
 *   nonce in style-src makes the browser ignore 'unsafe-inline', and React
 *   `style={...}` attributes (and tiptap's) cannot carry a nonce.
 * - img-src: card images are served same-origin by /api/images; no card body
 *   embeds an image from another host (checked 2026-10-16), and no avatar is
 *   rendered.
 * - connect-src: 'self' plus `connectOrigins`, which is the Supabase origin.
 *   An attachment upload PUTs its bytes from the browser straight to a
 *   Supabase Storage signed URL (lib/client-attachments.ts), to skip the
 *   serverless request-body limit. Everything else the browser calls is
 *   mykan itself.
 * - form-action includes accounts.google.com: without JavaScript the sign-in
 *   button is a native POST whose redirect to Google is checked against
 *   form-action.
 * - upgrade-insecure-requests only in production; there is nothing to upgrade
 *   on a local http dev server.
 */
export function buildCsp(
  nonce: string,
  dev: boolean,
  connectOrigins: readonly string[] = [],
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ["connect-src 'self'", ...connectOrigins].join(" "),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
  ];
  if (!dev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * The origin of a configured URL (SUPABASE_URL), or nothing when it is unset
 * or not a URL. Never throws: a bad value drops the upload origin from
 * connect-src (uploads then fail visibly) rather than failing every page.
 */
export function originOf(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const { origin } = new URL(url);
    return origin.startsWith("http") ? [origin] : [];
  } catch {
    return [];
  }
}

/** A fresh, unguessable nonce per request (128 random bits, base64). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * For responses that are not app screens: JSON from the MCP endpoints and the
 * Telegram webhook, the icons, robots.txt, next-auth's own endpoints. Nothing
 * may load and nothing may frame it. 'unsafe-inline' styles let next-auth's
 * built-in error page keep its look (it is HTML with an inline <style>, and
 * runs no script), and form-action matches the page policy for next-auth's
 * redirect to Google.
 */
export const STATIC_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; " +
  "form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'";

/**
 * The next.config.ts `source` patterns that get STATIC_CSP. Each is a path
 * the proxy matcher EXCLUDES (lib/security-headers.test.ts checks that), so
 * no response ever carries both policies. Never `/:path*`.
 *
 * /.well-known/security.txt is excluded from the proxy but deliberately NOT
 * listed here: there is no such file, so it answers Next's HTML 404 page, whose
 * scripts this policy would block. Without a nonce from the proxy that page
 * renders with no CSP at all; the simple headers still forbid framing it.
 */
export const STATIC_CSP_PATHS = [
  "/mcp",
  "/api/mcp",
  "/api/telegram",
  "/icon",
  "/apple-icon.png",
  "/robots.txt",
  "/api/auth/:path*",
] as const;
