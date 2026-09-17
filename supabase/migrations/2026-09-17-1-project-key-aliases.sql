-- Project keys can be renamed again, and old keys keep working (KANBAN-45).
--
-- 2026-09-16-4-project-keys.sql made a key permanent to protect references
-- written as text (shared links, card text, commit messages, memory files).
-- David, 2026-09-17: not acceptable, he renames keys. Old references are
-- protected instead by keeping every old key as an ALIAS of its project:
-- /OLD and /OLD-N redirect to /NEW and /NEW-N, and the MCP tools accept OLD-N.
--
-- The rules (all still enforced on projects.key: NOT NULL, format, not
-- reserved, unique across projects):
--   - renaming a key records the old key as an alias of the same project;
--   - renaming back to one of the project's own old keys is allowed: it becomes
--     current again and stops being an alias (the row is removed);
--   - a key that is ANOTHER project's alias can't be taken, by a rename or by a
--     new project, so an old link can never start pointing somewhere else;
--   - deleting a project deletes its aliases (on delete cascade), so its old
--     keys become free to use again.
-- The app mirrors these with clear messages (lib/project-keys.ts); these are
-- the backstop, and the messages below are matched by keyConstraintMessage.
--
-- Safety for the currently deployed code (KANBAN-44, #120): SAFE. That code
-- refuses key changes in the app and the API and never writes a key change, so
-- the rename trigger never fires and the alias table stays empty. The one new
-- check on INSERT (key is not an alias) can't refuse anything while the table
-- is empty. The new table is not read by the deployed code. Apply it any time
-- before merging the release that offers renames.
--
-- Concurrency: every check-and-write on a key takes a transaction-scoped
-- advisory lock on that key, so a rename recording OLD as an alias and a
-- concurrent create/rename taking OLD serialise (the loser sees the alias and
-- is refused, or Postgres reports a deadlock and aborts one of them).

-- 1. The aliases.
create table if not exists mykan.project_key_aliases (
  key        text primary key,
  project_id uuid not null references mykan.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint project_key_aliases_key_format check ((key collate "C") ~ '^[A-Z][A-Z0-9]{1,9}$')
);
create index if not exists project_key_aliases_project_idx
  on mykan.project_key_aliases (project_id);

-- Same posture as every other mykan table (2026-07-28-enable-rls.sql): RLS on,
-- no policies. The app uses the service role, which bypasses RLS.
alter table mykan.project_key_aliases enable row level security;

-- 2. Permanence goes.
drop trigger if exists projects_key_permanent on mykan.projects;
drop function if exists mykan.projects_key_permanent();

-- 3. Rename keeps the old key; nobody takes another project's old key.
create or replace function mykan.projects_key_aliases_guard() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.key is not distinct from old.key then
    return new;
  end if;

  -- Serialise with anything else touching these keys (sorted: fewer deadlocks).
  if tg_op = 'UPDATE' and old.key is not null and old.key < new.key then
    perform pg_advisory_xact_lock(hashtext('mykan.project_key:' || old.key));
    perform pg_advisory_xact_lock(hashtext('mykan.project_key:' || new.key));
  elsif tg_op = 'UPDATE' and old.key is not null then
    perform pg_advisory_xact_lock(hashtext('mykan.project_key:' || new.key));
    perform pg_advisory_xact_lock(hashtext('mykan.project_key:' || old.key));
  elsif new.key is not null then
    perform pg_advisory_xact_lock(hashtext('mykan.project_key:' || new.key));
  end if;

  -- The new key must not be another project's old key.
  if exists (
    select 1 from mykan.project_key_aliases
     where key = new.key
       and project_id is distinct from new.id
  ) then
    raise exception 'project key % is an old key of another project, and old links to it still go there',
      new.key
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- Renaming back to one of this project's own old keys: current again.
    delete from mykan.project_key_aliases
     where key = new.key and project_id = new.id;

    -- Keep the old key working. It was this project's current key, so no other
    -- project can own it as a key or an alias; refuse loudly if one somehow does.
    if old.key is not null then
      if exists (
        select 1 from mykan.project_key_aliases
         where key = old.key and project_id <> new.id
      ) then
        raise exception 'project key % is an old key of another project, and old links to it still go there',
          old.key
          using errcode = 'check_violation';
      end if;
      insert into mykan.project_key_aliases (key, project_id)
      values (old.key, new.id)
      on conflict (key) do nothing;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_key_aliases_guard on mykan.projects;
create trigger projects_key_aliases_guard
  before insert or update of key on mykan.projects
  for each row execute function mykan.projects_key_aliases_guard();

-- Rollback. Code first: reverting the app to the KANBAN-44 release is enough on
-- its own (it refuses renames and never reads the alias table), and this can
-- stay in place. Old keys recorded meanwhile simply stop redirecting.
--
-- FULL TEARDOWN (restores permanence; LOSSY: every recorded old key is dropped,
-- so /OLD links stop working). Run by hand, then delete the
-- 2026-09-17-1-project-key-aliases.sql row from mykan.schema_migrations:
--   drop trigger if exists projects_key_aliases_guard on mykan.projects;
--   drop function if exists mykan.projects_key_aliases_guard();
--   drop table if exists mykan.project_key_aliases;
--   create or replace function mykan.projects_key_permanent() returns trigger
--   language plpgsql set search_path = mykan, pg_temp as $f$
--   begin
--     if old.key is not null and new.key is distinct from old.key then
--       raise exception 'project key is permanent once set: % cannot become %',
--         old.key, coalesce(new.key, 'NULL') using errcode = 'check_violation';
--     end if;
--     return new;
--   end; $f$;
--   create trigger projects_key_permanent before update of key on mykan.projects
--     for each row execute function mykan.projects_key_permanent();
