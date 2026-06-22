-- Phase 1: stable per-project item reference (KEY-number, e.g. AMOS-12)
--
-- Adds a short project "key" and an immutable, per-project monotonic item
-- "number". The number is stamped on insert by a trigger (so every creation
-- path — REST and MCP — gets one) and never reused. A per-project advisory
-- lock serialises numbering so concurrent inserts can't collide.

-- Short key for a project, e.g. "AMOS". Displayed as the prefix of item refs.
alter table projects add column if not exists key text;

-- Per-project, immutable item number. Displayed as {project.key}-{number}.
alter table items add column if not exists number integer;

-- Backfill existing items: number them per project in creation order.
with ranked as (
  select id,
         row_number() over (partition by project_id order by created_at, id) as rn
  from items
)
update items i
set number = r.rn
from ranked r
where i.id = r.id and i.number is null;

-- Uniqueness per project (also the race backstop for the trigger).
create unique index if not exists items_project_number_idx
  on items (project_id, number);

-- Assign the next number per project on insert when not supplied.
create or replace function set_item_number() returns trigger as $$
begin
  if new.number is null then
    -- Serialise numbering within a project so concurrent inserts can't tie.
    perform pg_advisory_xact_lock(hashtext('item_number:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number
    from items where project_id = new.project_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_set_number on items;
create trigger items_set_number
  before insert on items
  for each row execute function set_item_number();
