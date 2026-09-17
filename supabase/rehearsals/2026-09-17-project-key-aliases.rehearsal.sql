-- Rehearsal for supabase/migrations/2026-09-17-1-project-key-aliases.sql (KANBAN-45).
--
-- NOT a migration (the runner only reads supabase/migrations/). Run it in the
-- SAME transaction right after the migration SQL, e.g.
--   begin;
--   <contents of 2026-09-17-1-project-key-aliases.sql>
--   <contents of this file>
--   rollback;
-- It always ends with `raise exception 'REHEARSAL RESULTS (rolled back): ...'`,
-- so the transaction aborts and nothing (migration included) is kept. Read the
-- results out of the error message: every line is
--   PASS|FAIL  [expect OK|REFUSED]  case  -> what happened
-- A FAIL line means the database did not behave as the case label says.
--
-- Throwaway rows: projects with made-up keys (RHA, RHB, RHC, ...). Each case
-- runs in its own BEGIN/EXCEPTION sub-block, so a refused case rolls back only
-- itself.

do $rehearsal$
declare
  r text := '';
  n_pass int := 0;
  n_fail int := 0;
  pa uuid;   -- project A: RHA -> RHA2 -> RHA3 -> RHA2
  pb uuid;   -- project B: RHB
  pc uuid;   -- project C: deleted at the end
  n int;
  k text;
  bad_key text;

begin
  -- ── Before anything: the table exists, empty, RLS on; old trigger gone ────
  select count(*) into n from mykan.project_key_aliases;
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] project_key_aliases exists and is empty';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] project_key_aliases empty -> ' || n || ' rows';
  end if;

  select count(*) into n
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'mykan' and c.relname = 'project_key_aliases' and c.relrowsecurity;
  if n = 1 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] RLS enabled on project_key_aliases';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] RLS enabled on project_key_aliases';
  end if;

  select count(*) into n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'projects' and t.tgname = 'projects_key_permanent';
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] projects_key_permanent trigger is gone';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] projects_key_permanent trigger is gone -> still there';
  end if;

  -- ── Every existing key is still valid ────────────────────────────────────
  select count(*) into n
    from mykan.projects
   where key is null
      or (key collate "C") !~ '^[A-Z][A-Z0-9]{1,9}$'
      or key = any (array['API', 'MCP', 'PROJECTS', 'SIGNIN', 'ICON', 'SETTINGS', 'LOGIN', 'AUTH']);
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] every existing key is present, well-formed and not reserved';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] every existing key valid -> ' || n || ' bad rows';
  end if;

  select string_agg(key, ',' order by key) into k from mykan.projects;
  r := r || E'\nINFO keys now: ' || coalesce(k, '(none)');

  -- ── Setup ────────────────────────────────────────────────────────────────
  insert into mykan.projects (name, key) values ('REHEARSAL key aliases A (rolled back)', 'RHA') returning id into pa;
  insert into mykan.projects (name, key) values ('REHEARSAL key aliases B (rolled back)', 'RHB') returning id into pb;
  insert into mykan.projects (name, key) values ('REHEARSAL key aliases C (rolled back)', 'RHC') returning id into pc;

  -- ── Non-key edits and re-sending the same key write no alias ─────────────
  begin
    update mykan.projects set key = 'RHA', name = 'REHEARSAL key aliases A renamed (rolled back)' where id = pa;
    select count(*) into n from mykan.project_key_aliases where project_id = pa;
    if n = 0 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] name edit + same key records no alias';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] name edit + same key records no alias -> ' || n || ' aliases';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] name edit + same key -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Rename creates an alias ──────────────────────────────────────────────
  begin
    update mykan.projects set key = 'RHA2' where id = pa;
    select string_agg(key, ',' order by key) into k from mykan.project_key_aliases where project_id = pa;
    if k = 'RHA' then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] rename RHA -> RHA2 keeps RHA as an alias';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] rename RHA -> RHA2 keeps RHA -> aliases ' || coalesce(k, '(none)');
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] rename RHA -> RHA2 -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Rename twice keeps both aliases ──────────────────────────────────────
  begin
    update mykan.projects set key = 'RHA3' where id = pa;
    select string_agg(key, ',' order by key) into k from mykan.project_key_aliases where project_id = pa;
    if k = 'RHA,RHA2' then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] rename RHA2 -> RHA3 keeps both RHA and RHA2';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] rename twice keeps both -> aliases ' || coalesce(k, '(none)');
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] rename RHA2 -> RHA3 -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Rename back to an own alias: allowed, alias removed, old key kept ────
  begin
    update mykan.projects set key = 'RHA2' where id = pa;
    select string_agg(key, ',' order by key) into k from mykan.project_key_aliases where project_id = pa;
    if k = 'RHA,RHA3' and (select key from mykan.projects where id = pa) = 'RHA2' then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] rename back RHA3 -> RHA2: RHA2 current again, aliases RHA,RHA3';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] rename back to own alias -> aliases ' || coalesce(k, '(none)');
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] rename back RHA3 -> RHA2 -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Taking another project's CURRENT key refused ─────────────────────────
  begin
    update mykan.projects set key = 'RHB' where id = pa;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] A takes B''s current key RHB -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] A takes B''s current key RHB -> ' || sqlstate || ' ' || sqlerrm;
  end;

  select string_agg(key, ',' order by key) into k from mykan.project_key_aliases where project_id = pa;
  if k = 'RHA,RHA3' then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] the refused rename left A''s aliases untouched';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] refused rename left aliases untouched -> ' || coalesce(k, '(none)');
  end if;

  -- ── Taking another project's ALIAS refused (rename) ──────────────────────
  begin
    update mykan.projects set key = 'RHA' where id = pb;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] B takes A''s old key RHA -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] B takes A''s old key RHA -> ' || sqlstate || ' ' || sqlerrm;
  end;

  select count(*) into n from mykan.project_key_aliases where project_id = pb;
  if n = 0 and (select key from mykan.projects where id = pb) = 'RHB' then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] B unchanged after the refusal (key RHB, no alias recorded)';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] B unchanged after the refusal -> ' || n || ' aliases';
  end if;

  -- ── New project with an alias key refused ────────────────────────────────
  begin
    insert into mykan.projects (name, key) values ('REHEARSAL takes an old key (rolled back)', 'RHA3');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] new project with A''s old key RHA3 -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] new project with A''s old key RHA3 -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Format and reserved rules still enforced on rename ───────────────────
  foreach bad_key in array array['rhb2', 'R', 'ABCDEFGHIJK', '1ABC', 'AB-C', ''] loop
    begin
      update mykan.projects set key = bad_key where id = pb;
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] rename to bad format "' || bad_key || '" -> accepted';
    exception when others then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] rename to bad format "' || bad_key || '" -> ' || sqlstate || ' ' || sqlerrm;
    end;
  end loop;

  foreach bad_key in array array['API', 'MCP', 'PROJECTS', 'SETTINGS', 'NEW'] loop
    begin
      update mykan.projects set key = bad_key where id = pb;
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] rename to reserved "' || bad_key || '" -> accepted';
    exception when others then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] rename to reserved "' || bad_key || '" -> ' || sqlstate || ' ' || sqlerrm;
    end;
  end loop;

  begin
    update mykan.projects set key = null where id = pb;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] clear key -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] clear key -> ' || sqlstate || ' ' || sqlerrm;
  end;

  select count(*) into n from mykan.project_key_aliases where project_id = pb;
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] refused renames recorded no alias for B';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] refused renames recorded no alias -> ' || n;
  end if;

  -- ── Alias table's own format check ───────────────────────────────────────
  begin
    insert into mykan.project_key_aliases (key, project_id) values ('bad-key', pb);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] alias with a bad format -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] alias with a bad format -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Project delete removes its aliases (and frees the old key) ───────────
  begin
    update mykan.projects set key = 'RHC2' where id = pc;
    delete from mykan.projects where id = pc;
    select count(*) into n from mykan.project_key_aliases where key in ('RHC', 'RHC2') or project_id = pc;
    if n = 0 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] deleting C removed its alias RHC';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] deleting C removed its aliases -> ' || n || ' left';
    end if;
    insert into mykan.projects (name, key) values ('REHEARSAL reuses a freed key (rolled back)', 'RHC');
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] RHC is free again after C was deleted';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] delete removes aliases / frees key -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Invariants at the end ────────────────────────────────────────────────
  select count(*) into n
    from mykan.project_key_aliases a join mykan.projects p on p.key = a.key;
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] no alias equals any project''s current key';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] no alias equals a current key -> ' || n;
  end if;

  select count(*) into n
    from mykan.projects
   where key is null
      or (key collate "C") !~ '^[A-Z][A-Z0-9]{1,9}$'
      or key = any (array['API', 'MCP', 'PROJECTS', 'SIGNIN', 'ICON', 'SETTINGS', 'LOGIN', 'AUTH']);
  if n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] every key (existing and rehearsal) still valid';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] every key still valid -> ' || n || ' bad rows';
  end if;

  raise exception 'REHEARSAL RESULTS (rolled back): % pass, % fail%', n_pass, n_fail, r;
end
$rehearsal$;
