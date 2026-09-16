-- Item entries: progress, questions and decisions (KANBAN-36, epic KANBAN-34).
--
-- A card's body stays a clean living spec; the running log of work moves here.
-- Each entry belongs to one item and has a kind with its own states:
--   progress  current  | superseded
--   question  open     | answered
--   decision  active   | superseded
--
-- Links, both on the entry that points:
--   supersedes_id   a progress/decision entry names the older entry of the SAME
--                   kind on the SAME item that it replaces. Set only when the row
--                   is inserted (immutable), and the target must be live
--                   (current/active) at that moment, so supersede chains are
--                   linear and can never form a cycle. At most one live
--                   (not soft-deleted) entry may supersede a given entry.
--   answered_by_id  a question names the decision on the SAME item that
--                   answered it. Only on a question in state 'answered'.
-- Same item (and, for supersedes, same kind) is enforced by composite foreign
-- keys; the decision-kind rule and immutability by a trigger. The app mirrors
-- every rule with a clear error (lib/item-entries-rules.ts).
--
-- Entries are editable (David, 2026-09-16), and every change is versioned in
-- item_entry_versions exactly the way item_versions works: one app chokepoint
-- (snapshotThenWriteEntry in lib/item-entries.ts) records the entry's PREVIOUS
-- state, then writes. Body autosaves coalesce within one editor session.
--
-- Soft delete: deleted_at/deleted_by. A delete is a versioned write and can be
-- undone; lists leave deleted entries out by default. Hard deletes only happen
-- through the item cascade (deleting the item removes its entries and their
-- versions).
--
-- RLS: enabled on both tables with NO policies, the same posture as
-- 2026-07-28-enable-rls.sql. The app reaches Supabase only with the service role
-- key (bypasses RLS); visibility follows the parent item's project and is
-- enforced app-side through loadVisibleItem.
--
-- Safe for the currently deployed code: new tables, a new function and trigger
-- on those tables only. Nothing existing is altered.

create table if not exists mykan.item_entries (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references mykan.items (id) on delete cascade,
  kind text not null,
  state text not null,
  body text not null,
  supersedes_id uuid,
  answered_by_id uuid,
  source text not null,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text,
  deleted_at timestamptz,
  deleted_by text,

  constraint item_entries_kind_check
    check (kind in ('progress', 'question', 'decision')),
  constraint item_entries_kind_state_check check (
    (kind = 'progress' and state in ('current', 'superseded')) or
    (kind = 'question' and state in ('open', 'answered')) or
    (kind = 'decision' and state in ('active', 'superseded'))
  ),
  constraint item_entries_source_check
    check (source in ('web', 'mcp', 'telegram', 'recovery')),
  constraint item_entries_body_not_blank check (length(btrim(body)) > 0),
  constraint item_entries_supersedes_check check (
    supersedes_id is null
    or (kind in ('progress', 'decision') and supersedes_id <> id)
  ),
  constraint item_entries_answered_by_check check (
    answered_by_id is null
    or (kind = 'question' and state = 'answered' and answered_by_id <> id)
  ),
  constraint item_entries_deleted_by_check
    check (deleted_by is null or deleted_at is not null),

  -- Targets for the composite foreign keys below.
  constraint item_entries_id_item_key unique (id, item_id),
  constraint item_entries_id_item_kind_key unique (id, item_id, kind),

  -- Same item AND same kind: the superseding row carries its own item_id/kind.
  -- No action on delete: entries are only hard-deleted by the item cascade,
  -- which removes a whole item's entries in one statement.
  constraint item_entries_supersedes_fkey
    foreign key (supersedes_id, item_id, kind)
    references mykan.item_entries (id, item_id, kind),
  -- Same item (the decision kind is checked by the trigger).
  constraint item_entries_answered_by_fkey
    foreign key (answered_by_id, item_id)
    references mykan.item_entries (id, item_id)
);

-- The card's list index (kind filter, newest first) — also serves kind-less
-- lists through its item_id prefix.
create index if not exists item_entries_item_kind_created_idx
  on mykan.item_entries (item_id, kind, created_at desc);
-- Lists across kinds, newest first.
create index if not exists item_entries_item_created_idx
  on mykan.item_entries (item_id, created_at desc);
-- One live successor per entry; also the lookup "what superseded X?".
create unique index if not exists item_entries_one_live_successor_idx
  on mykan.item_entries (supersedes_id)
  where supersedes_id is not null and deleted_at is null;
-- Referencing-side lookups for the self FKs (and "which questions did this
-- decision answer?").
create index if not exists item_entries_supersedes_idx
  on mykan.item_entries (supersedes_id) where supersedes_id is not null;
create index if not exists item_entries_answered_by_idx
  on mykan.item_entries (answered_by_id) where answered_by_id is not null;

create or replace function mykan.item_entries_guard() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
declare
  t record;
begin
  if tg_op = 'UPDATE' then
    if new.item_id <> old.item_id then
      raise exception 'An entry cannot move to another item'
        using errcode = 'check_violation';
    end if;
    if new.kind <> old.kind then
      raise exception 'An entry''s kind cannot change'
        using errcode = 'check_violation';
    end if;
    if new.supersedes_id is distinct from old.supersedes_id then
      raise exception 'An entry''s supersedes link is set when it is created and cannot change'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' and new.supersedes_id is not null then
    -- Lock the target so a concurrent supersede or reinstate can't slip past.
    select id, item_id, kind, state, deleted_at
      into t
      from mykan.item_entries
     where id = new.supersedes_id
     for update;
    if not found then
      raise exception 'The entry being superseded was not found'
        using errcode = 'foreign_key_violation';
    end if;
    if t.item_id <> new.item_id or t.kind <> new.kind then
      raise exception 'An entry can only supersede an entry of the same kind on the same item'
        using errcode = 'check_violation';
    end if;
    if t.state = 'superseded' then
      raise exception 'That entry is already superseded'
        using errcode = 'check_violation';
    end if;
    if t.deleted_at is not null then
      raise exception 'A deleted entry cannot be superseded'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.answered_by_id is not null then
    select id, item_id, kind into t
      from mykan.item_entries
     where id = new.answered_by_id;
    if not found then
      raise exception 'The answering decision was not found'
        using errcode = 'foreign_key_violation';
    end if;
    if t.item_id <> new.item_id then
      raise exception 'A question can only be answered by a decision on the same item'
        using errcode = 'check_violation';
    end if;
    if t.kind <> 'decision' then
      raise exception 'A question can only be answered by a decision'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists item_entries_guard on mykan.item_entries;
create trigger item_entries_guard
  before insert or update on mykan.item_entries
  for each row execute function mykan.item_entries_guard();

-- Entry history: one row per change, holding the entry's PREVIOUS state.
-- fields_changed names what the following write changed (body, state,
-- answered_by_id, deleted_at); edit_session fences body-autosave coalescing
-- exactly like item_versions.edit_session.
create table if not exists mykan.item_entry_versions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references mykan.item_entries (id) on delete cascade,
  snapshot jsonb not null,
  fields_changed text[] not null default '{}',
  source text not null
    constraint item_entry_versions_source_check
    check (source in ('web', 'mcp', 'telegram', 'recovery')),
  edit_session text,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists item_entry_versions_entry_created_idx
  on mykan.item_entry_versions (entry_id, created_at desc);

alter table mykan.item_entries        enable row level security;
alter table mykan.item_entry_versions enable row level security;

-- Rollback: normally NOTHING to undo. Applied-but-unused is a safe resting state
-- (new tables no deployed code reads), so a bad release is rolled back by
-- reverting the CODE and leaving this in place.
--
-- FULL TEARDOWN — LOSSY once entries exist: destroys every entry and its
-- history. Export first (select * from mykan.item_entries; select * from
-- mykan.item_entry_versions). Run by hand, then delete the
-- '2026-09-16-3-item-entries.sql' row from mykan.schema_migrations:
--   drop table if exists mykan.item_entry_versions;
--   drop trigger if exists item_entries_guard on mykan.item_entries;
--   drop table if exists mykan.item_entries;
--   drop function if exists mykan.item_entries_guard();
