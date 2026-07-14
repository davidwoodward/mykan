import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Active service keys from MYKAN_SERVICE_API_KEY (comma-separated for rotation). */
export function parseServiceKeys(): string[] {
  return (process.env.MYKAN_SERVICE_API_KEY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True when `presented` matches one of the active shared service keys. */
export function matchesServiceKey(presented: string): boolean {
  const keys = parseServiceKeys();
  if (keys.length === 0) return false;
  return keys.some((k) => safeEqual(presented, k));
}

/** True when the request carries a valid `Authorization: Bearer <key>` header. */
export function checkServiceKey(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  return matchesServiceKey(m[1]);
}
