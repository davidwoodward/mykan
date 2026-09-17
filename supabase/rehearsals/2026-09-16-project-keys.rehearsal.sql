-- Rehearsal for supabase/migrations/2026-09-16-4-project-keys.sql (KANBAN-44).
--
-- NOT a migration (the runner only reads supabase/migrations/). Run it in the
-- SAME transaction right after the migration SQL, e.g.
--   begin;
--   <contents of 2026-09-16-4-project-keys.sql>
--   <contents of this file>
--   rollback;
-- It always ends with `raise exception 'REHEARSAL RESULTS (rolled back): ...'`,
-- so the transaction aborts and nothing (migration included) is kept. Read the
-- results out of the error message: every line is
--   PASS|FAIL  [expect OK|REFUSED]  case  -> what happened
-- A FAIL line means the database did not behave as the case label says.
--
-- Throwaway rows: two projects with made-up keys (REHEARSEA, REHEARSEB). Each
-- case runs in its own BEGIN/EXCEPTION sub-block, so a refused case rolls back
-- only itself.

do $rehearsal$
declare
  r text := '';
  n_pass int := 0;
  n_fail int := 0;
  pid uuid;
  n int;
  k text;
  bad_key text;

begin
  -- ── Data the migration set / verified ────────────────────────────────────
  select key into k from mykan.projects where name = 'Standards';
  if k = 'STD' then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] Standards has key STD';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] Standards has key STD -> ' || coalesce(k, 'NULL');
  end if;

  select count(*) into n
    from mykan.projects
   where key is null
      or key !~ '^[A-Z][A-Z0-9]{1,9}$'
      or key = any (array['API', 'MCP', 'PROJECTS', 'SIGNIN', 'ICON', 'SETTINGS', 'LOGIN', 'AUTH']);
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] every existing key is present, well-formed and not reserved';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] every existing key valid -> ' || n || ' bad rows';
  end if;

  select count(*) into n
    from (select key from mykan.projects group by key having count(*) > 1) d;
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] no two projects share a key';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] no duplicate keys -> ' || n || ' duplicated';
  end if;

  select string_agg(key, ',' order by key) into k from mykan.projects;
  r := r || E'\nINFO keys now: ' || coalesce(k, '(none)');

  -- ── Valid insert ─────────────────────────────────────────────────────────
  begin
    insert into mykan.projects (name, key) values ('REHEARSAL project keys A (rolled back)', 'REHEARSEA')
      returning id into pid;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] insert with a valid key REHEARSEA';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] insert with a valid key -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.projects (name, key) values ('REHEARSAL project keys digits (rolled back)', 'R2D2');
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] insert with letters and digits R2D2';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] insert R2D2 -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Null key refused ─────────────────────────────────────────────────────
  begin
    insert into mykan.projects (name) values ('REHEARSAL no key (rolled back)');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] insert with no key -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] insert with no key -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.projects (name, key) values ('REHEARSAL null key (rolled back)', null);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] insert with key null -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] insert with key null -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Bad format refused ───────────────────────────────────────────────────
  foreach bad_key in array array['fpoon', 'A', 'ABCDEFGHIJK', '1ABC', 'AB-C', 'AB C', '', 'ÅBC'] loop
    begin
      insert into mykan.projects (name, key) values ('REHEARSAL bad key (rolled back)', bad_key);
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] bad format "' || bad_key || '" -> accepted';
    exception when others then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] bad format "' || bad_key || '" -> ' || sqlstate || ' ' || sqlerrm;
    end;
  end loop;

  -- ── Reserved words refused ───────────────────────────────────────────────
  foreach bad_key in array array['API', 'MCP', 'PROJECTS', 'SIGNIN', 'ICON', 'SETTINGS', 'AUTH', 'LOGIN'] loop
    begin
      insert into mykan.projects (name, key) values ('REHEARSAL reserved key (rolled back)', bad_key);
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] reserved "' || bad_key || '" -> accepted';
    exception when others then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] reserved "' || bad_key || '" -> ' || sqlstate || ' ' || sqlerrm;
    end;
  end loop;

  begin
    insert into mykan.projects (name, key) values ('REHEARSAL reserved prefix is fine (rolled back)', 'APIX');
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] APIX (a reserved word as a prefix only) is allowed';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] APIX allowed -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Duplicate key refused ────────────────────────────────────────────────
  begin
    insert into mykan.projects (name, key) values ('REHEARSAL duplicate key (rolled back)', 'REHEARSEA');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] duplicate key REHEARSEA -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] duplicate key REHEARSEA -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Key change refused (rename, clear), other edits fine ─────────────────
  begin
    update mykan.projects set key = 'REHEARSEB' where id = pid;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] rename REHEARSEA -> REHEARSEB -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] rename REHEARSEA -> REHEARSEB -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.projects set key = 'rehearsea' where id = pid;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] change key case -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] change key case -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.projects set key = null where id = pid;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] clear key -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] clear key -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.projects set key = 'STD' where id = pid;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] take another project''s key STD -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] take another project''s key STD -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.projects set key = 'REHEARSEA', name = 'REHEARSAL renamed (rolled back)' where id = pid;
    update mykan.projects set description = 'still editable' where id = pid;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] name/description edits, and re-sending the same key, still work';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] other edits -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── The Standards update touched only Standards ──────────────────────────
  select count(*) into n from mykan.projects where key = 'STD';
  if n = 1 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] exactly one project has STD';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] exactly one STD -> ' || n;
  end if;

  raise exception 'REHEARSAL RESULTS (rolled back): % pass, % fail%', n_pass, n_fail, r;
end
$rehearsal$;
