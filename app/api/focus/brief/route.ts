import { getSupabase } from "@/lib/supabase-server";
import { auth } from "@/lib/auth";
import { looksLikeMcpToken, verifyMcpToken } from "@/lib/mcp-tokens";
import { loadFocus } from "@/lib/focus-core";
import { formatFocusText } from "@/lib/focus-rules";

// The focus list as plain text, for the Claude Code SessionStart hook
// (KANBAN-80). Self-gated like every /api route: a personal `mk_` MCP token as
// a Bearer header (the hook's way in), or a signed-in session. The token is
// never logged. Off, or nothing to say → an empty 200 body, so the hook prints
// nothing. `?width=N` cuts titles to fit.

async function caller(req: Request): Promise<string | null> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (m) {
    const presented = m[1].trim();
    return looksLikeMcpToken(presented) ? verifyMcpToken(getSupabase(), presented) : null;
  }
  const session = await auth();
  return session?.user?.email ?? null;
}

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: Request) {
  const email = await caller(req);
  if (!email) return text("Unauthorized\n", 401);
  const r = await loadFocus(getSupabase(), email);
  if (!r.ok) return text(`${r.error}\n`, r.status);
  if (!r.data.enabled) return text("");
  const w = Number(new URL(req.url).searchParams.get("width"));
  const width = Number.isInteger(w) && w >= 20 && w <= 1000 ? w : undefined;
  return text(formatFocusText({ ...r.data, max_entries: r.data.settings.max_entries }, new Date(), width) + "\n");
}
