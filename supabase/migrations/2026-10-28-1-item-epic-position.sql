-- An epic's own order for its children (KANBAN-68).
--
-- items.epic_position orders a child within its epic, separately from the
-- board's items.position: reordering an epic never moves a card on the board,
-- and the reverse. It is null exactly when parent_id is null. The epic page and
-- the MCP group children by status (done by done_at; testing, in progress,
-- blocked and new by epic_position), so one per-epic sequence also keeps a
-- card's relative place when it changes status.
--
-- A card that joins an epic goes to the end of it; leaving clears the value.
-- The items_set_epic_position trigger does both, so every path that links a
-- card (web, MCP, Telegram, GitHub import) gets it without app code.
--
-- Backfill: existing children are numbered in the order the epic page showed
-- them until now, status (board column order) then number, so nothing moves.
--
-- Safe for the currently deployed code: the column is nullable, `select *` just
-- gains a field it ignores, and the trigger only writes epic_position.
--
-- RLS: no new table; items already has RLS enabled with no policies.

alter table mykan.items
  add column if not exists epic_position double precision;

update mykan.items i
   set epic_position = r.rn * 1024
  from (
    select id, row_number() over (partition by parent_id order by status, number) as rn
      from mykan.items
     where parent_id is not null
  ) r
 where i.id = r.id;

create or replace function mykan.items_set_epic_position() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
begin
  if new.parent_id is null then
    new.epic_position := null;
  elsif tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
    select coalesce(max(c.epic_position), 0) + 1024
      into new.epic_position
      from mykan.items c
     where c.parent_id = new.parent_id
       and c.id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists items_set_epic_position on mykan.items;
create trigger items_set_epic_position
  before insert or update of parent_id on mykan.items
  for each row execute function mykan.items_set_epic_position();
