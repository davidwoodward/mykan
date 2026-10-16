<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design & UX

Before building or changing any UI, read **`docs/DESIGN.md`** and follow it — it captures
mykan's deliberate interaction patterns (nothing written while typing, one save on Esc/click-off, inline
keyboard-first tags, token-based light/dark theming, labeled inline-SVG icons). These are
app-specific choices and override the cross-project UI defaults where they differ.

# Commits & shipping

When a change is complete and verified, **ship it end to end without being asked** — do not stop at a local commit:

1. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message (e.g. `fix(items): …`, `feat(tags): …`), matching the style already in the git log.
2. Put the work on a branch, push it, and open a PR (`gh pr create`).
3. Merge the PR into `main` (`gh pr merge`) — this is what triggers the Vercel production deploy. Then sync local `main`.

Don't leave finished work sitting uncommitted, unpushed, or in an open PR waiting on a nudge.
# Security headers & the auth gate

Every response carries security headers, and the page CSP is **enforced with a per-request nonce** (KANBAN-61, ported from lobe; `lib/security-headers.ts`).

- `proxy.ts` CALLS `auth(request, event)` inline and rebuilds a pass-through with `NextResponse.next({ request: { headers } })` carrying `x-nonce` and `content-security-policy`, keeping next-auth's Set-Cookie. **Never wrap it as `auth((req) => ...)`**: next-auth runs a wrapper's handler even when `authorized` returned false, which un-gates every screen. Anything auth() returns that is not a Response is a 500 (`lib/proxy-gate.ts`, fail closed).
- The root layout reads `x-nonce` for the theme script, which also makes every page dynamic. `style-src` keeps `'unsafe-inline'` and must never get a nonce. `connect-src` carries the `SUPABASE_URL` origin because attachment uploads PUT straight to a Supabase signed URL from the browser.
- The static CSP in `next.config.ts` goes ONLY on proxy-excluded non-page paths (`STATIC_CSP_PATHS`): a browser enforces every CSP header, so stacking it on a page blocks every script. A test pins that each one is unmatched.
- **Every matcher exclusion is anchored** (`lib/proxy-matcher.ts` says what each is for; it must stay byte-identical to `proxy.ts`'s literal, and a test checks). Never exclude by file extension.
- `/robots.txt` disallows everything. There is deliberately **no security.txt**: `/.well-known/security.txt` is excluded so it 404s instead of redirecting.
- `/api/*` routes are let through by `authorized` and must gate themselves (`requireSession`, `gateEntry`). Every `"use server"` export must call its own guard too; today the only ones are sign-in and sign-out.
- After any change to `proxy.ts`, the matcher, `lib/auth.ts` or the headers, run `npm run smoke:auth-gate` (`-- --no-build` reuses `.next`). It runs a production build on a free port with a throwaway `AUTH_SECRET` and a minted session cookie, and prints no credential.
