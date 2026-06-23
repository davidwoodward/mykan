-- Phase 2: a "Blocked" status and multi-assignees on items.

-- New status value, ordered between in_progress and done.
alter type item_status add value if not exists 'blocked' before 'done';

-- Assignees: member emails (the whitelist). Surfaced in the UI only on shared
-- (non-private) projects. GIN index supports "assigned to X" filters later.
alter table items add column if not exists assignees text[] not null default '{}';
create index if not exists items_assignees_idx on items using gin (assignees);
