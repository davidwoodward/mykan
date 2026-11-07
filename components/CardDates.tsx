"use client";

import { useSyncExternalStore } from "react";
import { displayName, fullDateTime, shortDate, timeAgo } from "@/lib/format";
import type { Item } from "@/lib/types";

const noop = () => () => {};

/**
 * When the card was created and last changed, and by whom (KANBAN-71):
 * "Created Oct 3, 2026 by David · Updated 2h ago by Woody". Each part's exact
 * date and time is its tooltip. Dates depend on the viewer's clock and time
 * zone, so nothing renders on the server pass (see DESIGN.md, hydration).
 */
export function CardDates({ item }: { item: Item }) {
  const client = useSyncExternalStore(noop, () => true, () => false);
  if (!client) return null;
  const created = shortDate(item.created_at);
  const updated = timeAgo(item.updated_at);
  if (!created && !updated) return null;
  const by = (email: string | null) => (email ? <> by {displayName(email)}</> : null);
  return (
    <p className="flex flex-wrap gap-x-1.5 gap-y-0.5 border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
      {created ? (
        <span title={fullDateTime(item.created_at)}>
          Created {created}
          {by(item.created_by)}
        </span>
      ) : null}
      {created && updated ? <span aria-hidden="true">·</span> : null}
      {updated ? (
        <span title={fullDateTime(item.updated_at)}>
          Updated {updated}
          {by(item.updated_by)}
        </span>
      ) : null}
    </p>
  );
}
