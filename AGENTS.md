<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Design & UX

Before building or changing any UI, read **`docs/DESIGN.md`** and follow it — it captures
mykan's deliberate interaction patterns (implicit autosave + Esc/click-off dismiss, inline
keyboard-first tags, token-based light/dark theming, labeled inline-SVG icons). These are
app-specific choices and override the cross-project UI defaults where they differ.

# Commits & shipping

When a change is complete and verified, **ship it end to end without being asked** — do not stop at a local commit:

1. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message (e.g. `fix(items): …`, `feat(tags): …`), matching the style already in the git log.
2. Put the work on a branch, push it, and open a PR (`gh pr create`).
3. Merge the PR into `main` (`gh pr merge`) — this is what triggers the Vercel production deploy. Then sync local `main`.

Don't leave finished work sitting uncommitted, unpushed, or in an open PR waiting on a nudge.
