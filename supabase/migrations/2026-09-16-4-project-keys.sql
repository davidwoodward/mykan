-- Project keys: required, well-formed, unique, never a reserved word, and
-- permanent (KANBAN-44).
--
-- The key is now the project's URL (/FPOON) and the prefix of every card URL
-- (/FPOON-42), so (David, 2026-09-16):
--   - every project has one: the Standards project, the only one without, gets STD;
--   - a key is 2 to 10 uppercase letters and digits, starting with a letter;
--   - a key can never equal a top-level app route (api, mcp, projects, signin,
--     icon) or a route the app is likely to grow; the list mirrors RESERVED_KEYS
--     in lib/card-url.ts, keep the two in step;
--   - two projects can't share a key (card URLs must name one card);
--   - a key can't be changed once set: no renames, no old-key redirects.
-- The app mirrors every rule with a clear message (lib/card-url.ts keyError,
-- lib/project-keys.ts); these are the backstop.
--
-- Existing keys (checked 2026-09-16 over every project the owner can see):
-- KANBAN BRAIN ASSET FPOON FIN AMOS PERP PS HELM PUR GANDY DUG, plus Standards
-- (null). All fit the format, none is reserved, none repeats. The guard below
-- re-checks EVERY row (including projects other users own) and aborts the whole
-- migration, naming the offenders, rather than half-applying.
--
-- Safety for the currently deployed code (before the KANBAN-44 release):
-- NOT fully safe. Today's code can write a null key (creating a project with the
-- Key field left blank sends key: null) and can rename or clear a key (the
-- project edit panel). After this migration those writes are refused by the
-- database (the create returns a 500, the edit shows "Save failed"). Everything
-- else deployed today is unaffected: reads, item writes, and saving a project
-- edit that leaves the key as it is (the trigger only refuses an actual change).
-- So apply it immediately before merging the release that requires a key and
-- stops offering renames, and avoid creating projects or editing keys in the
-- gap between the two.

-- 1. Standards gets STD (only the untouched row: no key yet, that exact name).
update mykan.projects
   set key = 'STD', updated_at = now()
 where key is null
   and name = 'Standards';

-- 2. Every row must already satisfy the rules; otherwise stop and say which.
do $guard$
declare
  bad text;
begin
  select string_agg(format('%s [%s] key=%s', p.name, p.id, coalesce(p.key, 'NULL')), '; ')
    into bad
    from mykan.projects p
   where p.key is null
      or (p.key collate "C") !~ '^[A-Z][A-Z0-9]{1,9}$'
      or p.key = any (array[
           'API', 'MCP', 'PROJECTS', 'SIGNIN', 'ICON',
           'AUTH', 'LOGIN', 'LOGOUT', 'SIGNOUT', 'SETTINGS', 'ADMIN', 'NEW', 'HOME',
           'STATIC', 'PUBLIC', 'FAVICON', 'ROBOTS', 'SITEMAP'
         ])
      or exists (select 1 from mykan.projects q where q.key = p.key and q.id <> p.id);
  if bad is not null then
    raise exception 'project keys must be fixed before 2026-09-16-4-project-keys.sql: %', bad;
  end if;
end
$guard$;

-- 3. The rules.
alter table mykan.projects alter column key set not null;

alter table mykan.projects
  add constraint projects_key_format check ((key collate "C") ~ '^[A-Z][A-Z0-9]{1,9}$');

alter table mykan.projects
  add constraint projects_key_not_reserved check (key <> all (array[
    'API', 'MCP', 'PROJECTS', 'SIGNIN', 'ICON',
    'AUTH', 'LOGIN', 'LOGOUT', 'SIGNOUT', 'SETTINGS', 'ADMIN', 'NEW', 'HOME',
    'STATIC', 'PUBLIC', 'FAVICON', 'ROBOTS', 'SITEMAP'
  ]));

create unique index if not exists projects_key_unique on mykan.projects (key);

-- 4. Permanent once set. NOT NULL already stops clearing a key; this stops
-- renames (case changes included). Re-sending the same key is not a change.
create or replace function mykan.projects_key_permanent() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
begin
  if old.key is not null and new.key is distinct from old.key then
    raise exception 'project key is permanent once set: % cannot become %',
      old.key, coalesce(new.key, 'NULL')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_key_permanent on mykan.projects;
create trigger projects_key_permanent
  before update of key on mykan.projects
  for each row execute function mykan.projects_key_permanent();

-- Rollback: normally NOTHING to undo. The constraints only refuse writes the
-- released code no longer makes, so a bad release is rolled back by reverting
-- the CODE and leaving this in place. The old code then can't blank or rename a
-- key (the intended rule anyway), and creating a project with its Key field left
-- blank fails, so fill it in.
--
-- FULL TEARDOWN (not lossy: STD stays, which is harmless). Run by hand, then
-- delete the 2026-09-16-4-project-keys.sql row from mykan.schema_migrations:
--   drop trigger if exists projects_key_permanent on mykan.projects;
--   drop function if exists mykan.projects_key_permanent();
--   drop index if exists mykan.projects_key_unique;
--   alter table mykan.projects drop constraint if exists projects_key_not_reserved;
--   alter table mykan.projects drop constraint if exists projects_key_format;
--   alter table mykan.projects alter column key drop not null;
-- (To also undo STD: update mykan.projects set key = null where name = 'Standards'
--  and key = 'STD'; only after the trigger is dropped.)
