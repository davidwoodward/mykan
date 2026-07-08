-- Item history (KANBAN-10): whole-item version snapshots.
--
-- Every field mutation routes through one chokepoint (snapshotThenWrite in
-- lib/item-history.ts) which inserts a snapshot of the item's PREVIOUS state
-- before applying the patch. A snapshot captures the mutable fields as one
-- jsonb blob: {body, tags, assignees, category_id, type, status}. Position and
-- archived_at are deliberately untracked (reorder/archive noise).
--
-- fields_changed records which tracked fields the write that FOLLOWED this
-- snapshot modified — it drives both the history panel's change summaries
-- ("body edited", "tags +urgent") and the body-burst coalescing rule (skip a
-- snapshot when the incoming change is body-only and the latest entry is a
-- body-only edit by the same actor+source under 15 minutes old).

create table if not exists mykan.item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references mykan.items (id) on delete cascade,
  snapshot jsonb not null,
  fields_changed text[] not null default '{}',
  source text not null check (source in ('web', 'mcp', 'telegram', 'recovery')),
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists item_versions_item_created_idx
  on mykan.item_versions (item_id, created_at desc);
