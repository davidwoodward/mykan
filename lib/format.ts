// Relative + extension so `node --test` can load this file directly (it does
// not resolve the "@/" tsconfig alias), the same reason the other tested lib
// modules stay dependency-light.
import { canonicalEmail } from "./types.ts";

/**
 * A user-facing item reference: "AMOS-12" when the project has a key, else
 * "#12". Null when the item has no number yet (shouldn't happen post-migration).
 */
export function itemRef(
  key: string | null | undefined,
  number: number | null | undefined,
): string | null {
  if (number == null) return null;
  const k = (key ?? "").trim();
  return k ? `${k}-${number}` : `#${number}`;
}

export function localPart(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

/**
 * What each member is called on screen. An email local-part is how the account
 * is spelled, not what the person is called — "matthewl", "kenyon.congdon" and
 * "cheriewoodward27" all read as addresses rather than names — so members get a
 * short human name here and `displayName` falls back to the local-part only for
 * anyone not listed (no current member is).
 *
 * The first letter is also the assignee avatar's initial, so the names must stay
 * distinct on that letter: D / M / W / K / C today. "Woody" exists because
 * dwoody55 would otherwise collide with dawoodward on "D"; format.test.ts
 * asserts the set stays unique, so a new member needs a name that keeps it so.
 *
 * Keys are canonical (see `canonicalEmail`), which is the form member emails are
 * stored in, so a Gmail address matches however its dots are written.
 */
const DISPLAY_NAMES: Record<string, string> = {
  "dawoodward@gmail.com": "David",
  "matthewl@experiencealign.com": "Matthew",
  "dwoody55@gmail.com": "Woody",
  "kenyon.congdon@permitsaige.com": "Kenyon",
  "cheriewoodward27@gmail.com": "Cherie",
};

/** The name to show for a member — an override when set, else the local-part. */
export function displayName(email: string | null | undefined): string {
  if (!email) return "—";
  return DISPLAY_NAMES[canonicalEmail(email)] ?? localPart(email);
}

/** Compact absolute date, e.g. "Jul 2, 2026". Empty string for null/invalid. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  if (ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}
