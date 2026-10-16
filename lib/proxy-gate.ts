/**
 * The decision proxy.ts makes about next-auth's answer, PURE so it is unit
 * tested (lib/proxy-gate.test.ts) without loading next-auth (KANBAN-61).
 */

export type GateOutcome =
  | { kind: "pass"; setCookies: string[] }
  | { kind: "respond"; response: Response }
  | { kind: "fail" };

/**
 * What next-auth's inline middleware call answered. A pass-through carries
 * `x-middleware-next` (and any refreshed session cookie); anything else that
 * is a Response (the redirect to /signin) is returned as-is. Anything that is
 * NOT a Response means next-auth took a path this code does not expect, and
 * the proxy answers 500 rather than letting the request through: fail closed.
 */
export function gateOutcome(result: unknown): GateOutcome {
  if (!(result instanceof Response)) return { kind: "fail" };
  if (result.headers.get("x-middleware-next")) {
    return { kind: "pass", setCookies: result.headers.getSetCookie() };
  }
  return { kind: "respond", response: result };
}
