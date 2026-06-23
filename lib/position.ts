/**
 * The fractional position for an item dropped between two neighbors (either may
 * be undefined at a list edge). `position` is a global per-project order shared
 * by the board (per-status columns) and the flat list. Used by both.
 */
export function computePosition(
  before: number | undefined,
  after: number | undefined,
): number {
  if (before == null && after == null) return 1024; // empty list
  if (before == null) return (after as number) - 1024; // before everything
  if (after == null) return before + 1024; // after everything
  return (before + after) / 2; // between two
}
