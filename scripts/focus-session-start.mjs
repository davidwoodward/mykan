#!/usr/bin/env node
// Claude Code SessionStart hook: put your mykan focus list in front of you at
// the start of every session, in any repo (KANBAN-80).
//
// Install: copy to ~/.claude/hooks/mykan-focus.mjs and register it under
// hooks.SessionStart in ~/.claude/settings.json:
//   { "type": "command", "command": "node ~/.claude/hooks/mykan-focus.mjs", "timeout": 10 }
//
// It reads your personal mykan MCP token BY REFERENCE from
// ~/.config/mykan/mcp-token (override with MYKAN_TOKEN_FILE) and calls
// GET /api/focus/brief, which returns your list as plain text, or nothing when
// your focus list is off. The token is sent only in the Authorization header
// and is never printed.
//
// Output: the list as a systemMessage (shown to you) and as additionalContext
// (so the session's agent knows your priorities and asks you to review when a
// review is due). Quiet on trouble: no token file → nothing; mykan unreachable
// or slow (4s) → one short line; never a non-zero exit, never a blocked session.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tokenFile = process.env.MYKAN_TOKEN_FILE || join(homedir(), ".config", "mykan", "mcp-token");
const base = (process.env.MYKAN_URL || "https://kanban.dbwoodward.com").replace(/\/+$/, "");

function emit(shown, context) {
  const out = { systemMessage: shown };
  if (context) out.hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: context };
  process.stdout.write(JSON.stringify(out));
}

let token;
try {
  token = readFileSync(tokenFile, "utf8").trim();
} catch {
  process.exit(0); // no token on this machine: say nothing
}
if (!token) process.exit(0);

try {
  const res = await fetch(`${base}/api/focus/brief?width=100`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(4000),
  });
  if (res.status === 401) {
    emit("mykan focus list: the token in ~/.config/mykan/mcp-token was refused. Mint a new one in mykan (key icon, top bar).");
    process.exit(0);
  }
  if (!res.ok) {
    emit(`mykan focus list: unavailable (HTTP ${res.status}).`);
    process.exit(0);
  }
  const text = (await res.text()).trim();
  if (!text) process.exit(0); // focus list is off
  const reviewDue = /^Review due:/m.test(text);
  emit(
    text,
    `The user's mykan focus list (their own ranked priorities across projects):\n${text}\n` +
      (reviewDue
        ? "A review is due. Before starting other work, show the user this list and the reasons, and ask whether to re-prioritize (mykan add_focus, drop_focus, set_focus_order) or confirm it as is (confirm_focus_review)."
        : "No review is due. Keep these priorities in mind; don't change the list unless the user asks."),
  );
} catch {
  emit("mykan focus list: couldn't reach mykan.");
}
process.exit(0);
