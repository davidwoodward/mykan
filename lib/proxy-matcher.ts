/**
 * Which paths the auth gate (proxy.ts) intercepts (KANBAN-61).
 *
 * Lives in its own dependency-free module so it can be unit tested without
 * importing proxy.ts, which pulls in next-auth and everything behind it.
 *
 * Every exclusion is ANCHORED: `api/auth`, `api/mcp`, `api/telegram`, `mcp`
 * and `icon` end at the path's end or a `/` (so a future /icons or
 * /api/authors is gated), `apple-icon.png`, `robots.txt`, `security.txt` and
 * `favicon.ico` are exact, and Next's own files are excluded only under
 * `_next/static` and `_next/image`. Never by extension: a `.png` rule lets any
 * app path ending in one (/KANBAN-1.png) render ungated and with no CSP. The
 * leftover create-next-app SVGs in public/ are referenced by nothing, so
 * gating them costs nothing.
 *
 * - api/auth IS the sign-in flow.
 * - /mcp, /api/mcp authenticate with a bearer token and their clients parse
 *   JSON; a redirect to the /signin HTML would break every MCP call.
 * - /api/telegram is the bot webhook, checked by its own secret header.
 * - /icon and /apple-icon.png are asked for by /signin, before any session.
 * - /robots.txt: a crawler redirected to /signin gets HTML, not a robots file.
 * - /.well-known/security.txt answers a plain 404 rather than a 307 to
 *   /signin. There is deliberately NO security.txt (David's lobe decision,
 *   2026-10-15, applied to mykan by KANBAN-61).
 *
 * Every other /api route is matched (so it gets the CSP) but let through by
 * the `authorized` callback in lib/auth.ts and gates itself (requireSession).
 * /signin is matched too and let through by the same callback.
 *
 * This array must stay byte-for-byte identical to the literal inside
 * proxy.ts's own `config.matcher` (Next statically parses that file's config
 * at compile time and will not accept an import of this constant). The test
 * "the tested pattern is the one proxy.ts actually ships" in
 * lib/proxy-matcher.test.ts reads proxy.ts's source and asserts it.
 */
export const PROXY_MATCHER = [
  "/((?!(?:api/auth|api/mcp|api/telegram|mcp|icon)(?:$|/)|apple-icon\\.png$|robots\\.txt$|\\.well-known/security\\.txt$|_next/(?:static|image)(?:$|/)|favicon\\.ico$).*)",
];
