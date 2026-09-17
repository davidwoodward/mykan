// The app-wide tooltip layer's pure decisions (KANBAN-47): where the tip goes,
// and what an element's accessible name/description should become once its
// `title` is moved out of the way. No DOM here; see lib/tooltip-layer.ts.

export type Rect = { left: number; top: number; right: number; bottom: number };

export type TipPlacement = {
  left: number;
  top: number;
  /** Which side of the anchor the tip ended up on. */
  side: "below" | "above";
};

/**
 * Place a `width` x `height` tip against `anchor` inside a `viewportWidth` x
 * `viewportHeight` viewport (all in CSS pixels, viewport coordinates):
 *
 * - below the anchor, `gap` px away, horizontally centred on it;
 * - above instead when it doesn't fit below but does fit above (if it fits
 *   neither, whichever side has more room);
 * - clamped so it stays `margin` px inside the viewport on every edge (a tip
 *   wider than the viewport pins to the left margin).
 */
export function placeTip({
  anchor,
  width,
  height,
  viewportWidth,
  viewportHeight,
  gap = 6,
  margin = 4,
}: {
  anchor: Rect;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  gap?: number;
  margin?: number;
}): TipPlacement {
  const roomBelow = viewportHeight - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;
  const side: TipPlacement["side"] =
    height <= roomBelow || roomBelow >= roomAbove ? "below" : "above";
  let top = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;
  top = clamp(top, margin, viewportHeight - margin - height);

  const centre = (anchor.left + anchor.right) / 2;
  const left = clamp(centre - width / 2, margin, viewportWidth - margin - width);
  return { left: Math.round(left), top: Math.round(top), side };
}

/** Clamp to [min, max]; when the range is empty (max < min) `min` wins. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, max));
}

/** Normalise a title/tip value: whitespace-only counts as no tip. */
export function tipText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t ? t : null;
}

/**
 * What the element's native `title` was doing for assistive tech, and so what
 * to set when the layer moves it to `data-tip` (native `title` is the
 * accessible name of an element that has no other name, and otherwise its
 * accessible description).
 *
 * - `label`: set `aria-label` to the tip. Only when the element has no other
 *   name: no aria-label/aria-labelledby, no <label> (form controls), no text.
 * - `description`: set `aria-description` to the tip, when the element has a
 *   name that says something different and no description of its own.
 * - `none`: nothing to do (the name already contains the tip's words, or the
 *   element has a description of its own).
 */
export function titleA11yRole({
  tip,
  ariaLabel,
  hasLabelledBy,
  hasLabels,
  text,
  hasDescription,
}: {
  tip: string;
  ariaLabel: string | null;
  hasLabelledBy: boolean;
  /** A form control with an associated <label>. */
  hasLabels: boolean;
  /** The element's visible text content. */
  text: string;
  /** aria-describedby or aria-description already present. */
  hasDescription: boolean;
}): "label" | "description" | "none" {
  const label = tipText(ariaLabel);
  const ownText = tipText(text);
  if (!label && !hasLabelledBy && !hasLabels && !ownText) return "label";
  if (hasDescription) return "none";
  const name = label ?? ownText;
  // The name already says it ("Delete" on "Delete Fix the board").
  if (name && name.toLowerCase().includes(tip.toLowerCase())) return "none";
  return "description";
}
