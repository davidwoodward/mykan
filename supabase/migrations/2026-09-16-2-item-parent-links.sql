-- Epic parent/child links (KANBAN-41).
--
-- The link is stored ONCE, on the child: items.parent_id → the epic. An epic's
-- children are derived (items where parent_id = epic.id), so the two directions
-- can never disagree.
--
-- Guardrails (David, 2026-09-16), enforced here in the database and mirrored
-- app-side (parentLinkError / typeChangeError in lib/types.ts) for clear errors:
--   1. One level only: an epic cannot have a parent, and a child cannot be an epic.
--   2. Same project only: parent and child must be in the same project.
--   3. (UI) Epics show on the board like any other card — nothing to enforce here.
--   Also: no self-parent; the parent must be type 'epic'; deleting an epic sets its
--   children's parent_id to null (FK on delete set null); changing an epic's type
--   away from 'epic' is refused while it has children.
--
-- Archived items are NOT special-cased in the database: an archived child keeps
-- its link (the app leaves it out of the epic's children list and N/M count), and
-- archiving an epic keeps its children's links. Only the app refuses an archived
-- epic as a NEW parent.
--
-- Safe for the currently deployed code (which knows nothing about parent_id or
-- 'epic'): the column is nullable with no default, so existing inserts/updates
-- are untouched; `select *` just gains a field it ignores; the trigger is a no-op
-- unless parent_id is set, a type changes AWAY from 'epic', or project_id changes
-- on an item that has children — none of which today's code can do.
--
-- Every 'epic' literal lives inside the plpgsql function body (resolved at call
-- time, not DDL time), so this file never uses the enum label added by
-- 2026-09-16-1-item-type-epic.sql at DDL time.
--
-- RLS: no new table. items already has RLS enabled with no policies
-- (2026-07-28-enable-rls.sql); the new column is covered by that.

alter table mykan.items
  add column if not exists parent_id uuid
  references mykan.items (id) on delete set null;

do $$ begin
  alter table mykan.items
    add constraint items_parent_not_self check (parent_id is null or parent_id <> id);
exception when duplicate_object then null;
end $$;

create index if not exists items_parent_idx on mykan.items (parent_id);

create or replace function mykan.items_enforce_parent_link() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
declare
  p record;
begin
  -- A type change away from 'epic', or a project move, would strand children.
  if tg_op = 'UPDATE' then
    if old.type::text = 'epic' and new.type::text <> 'epic'
       and exists (select 1 from mykan.items c where c.parent_id = old.id) then
      raise exception 'This epic has child items; unlink them before changing its type'
        using errcode = 'check_violation';
    end if;
    if new.project_id <> old.project_id
       and exists (select 1 from mykan.items c where c.parent_id = old.id) then
      raise exception 'This epic has child items; it cannot move to another project'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'An item cannot be its own parent'
      using errcode = 'check_violation';
  end if;

  if new.type::text = 'epic' then
    raise exception 'An epic cannot have a parent (epics are one level only)'
      using errcode = 'check_violation';
  end if;

  -- Lock the parent row so a concurrent retype/move of the epic can't slip past.
  select id, type::text as type, project_id, parent_id
    into p
    from mykan.items
   where id = new.parent_id
   for share;

  if not found then
    raise exception 'Parent item not found'
      using errcode = 'foreign_key_violation';
  end if;
  if p.type <> 'epic' then
    raise exception 'The parent must be an epic'
      using errcode = 'check_violation';
  end if;
  if p.project_id <> new.project_id then
    raise exception 'The parent epic must be in the same project'
      using errcode = 'check_violation';
  end if;
  if p.parent_id is not null then
    raise exception 'The parent epic cannot itself have a parent'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists items_enforce_parent_link on mykan.items;
create trigger items_enforce_parent_link
  before insert or update of parent_id, type, project_id on mykan.items
  for each row execute function mykan.items_enforce_parent_link();

-- Rollback: normally NOTHING to undo in the schema. Applied-but-unused is a safe
-- resting state (nullable column, inert trigger, code that ignores both), so a
-- bad release is rolled back by reverting the CODE and leaving this in place.
--
-- FULL TEARDOWN — LOSSY: destroys every parent link and which cards were epics.
-- Export first (select id, type, parent_id from mykan.items where type = 'epic'
-- or parent_id is not null). Run by hand, then delete both 2026-09-16-* rows
-- from mykan.schema_migrations:
--   drop trigger if exists items_enforce_parent_link on mykan.items;
--   drop function if exists mykan.items_enforce_parent_link();
--   drop index if exists mykan.items_parent_idx;
--   alter table mykan.items drop constraint if exists items_parent_not_self;
--   alter table mykan.items drop column if exists parent_id;
--   update mykan.items set type = 'feature' where type = 'epic';
-- Postgres can't drop an enum label; an unused 'epic' left on item_type is harmless.
