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
 * Short display names for members whose email local-part would otherwise be
 * ambiguous or unwieldy. dwoody55 shows as "Woody" (initial "W") so it doesn't
 * collide with dawoodward's "D" on assignee avatars.
 */
const DISPLAY_NAMES: Record<string, string> = {
  "dwoody55@gmail.com": "Woody",
};

/** The name to show for a member — an override when set, else the local-part. */
export function displayName(email: string | null | undefined): string {
  if (!email) return "—";
  return DISPLAY_NAMES[email.trim().toLowerCase()] ?? localPart(email);
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
