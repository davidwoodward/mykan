import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped MCP identity (KANBAN-30). The MCP tools call mcpActorEmail()
// with no request context, so we carry the authenticated user's email through
// an AsyncLocalStorage set once by the route's auth gate. Every tool invoked
// inside runAsMcpActor() then acts as that user (→ their GitHub PAT). Without
// this, MCP had a single global identity; the whole point of per-user tokens is
// that "whose PAT" follows the token, not a server constant.

const store = new AsyncLocalStorage<string>();

/** Run `fn` with the given email as the current MCP actor for its async scope. */
export function runAsMcpActor<T>(email: string, fn: () => T): T {
  return store.run(email.trim().toLowerCase(), fn);
}

/** The current request's MCP actor email, or undefined outside a run(). */
export function currentMcpActor(): string | undefined {
  return store.getStore();
}
