-- Rehearsal for supabase/migrations/2026-11-24-1-focus-list.sql (KANBAN-75).
--
-- NOT a migration (the runner only reads supabase/migrations/). Run it in the
-- SAME transaction right after the migration SQL:
--   begin;
--   <contents of 2026-11-24-1-focus-list.sql>
--   <contents of this file>
--   rollback;
-- It always ends with `raise exception 'REHEARSAL RESULTS (rolled back): ...'`,
-- so the transaction aborts and nothing (migration included) is kept. Every
-- result line is
--   PASS|FAIL  [expect OK|REFUSED]  case  -> what happened
--
-- Throwaway rows: projects keyed RHFA, RHFB, RHFC owned by made-up emails.
-- Each case runs in its own BEGIN/EXCEPTION sub-block, so a refused case rolls
-- back only itself.

do $rehearsal$
declare
  r text := '';
  n_pass int := 0;
  n_fail int := 0;
  ua text := 'rehearsal-a@example.invalid';
  ub text := 'rehearsal-b@example.invalid';
  p_personal uuid;
  p_work uuid;
  item1 uuid;
  item2 uuid;
  e_a uuid;
  e_b uuid;
  e_removed uuid;
  n int;
  s record;
begin
  -- ── Tables exist, RLS on ─────────────────────────────────────────────────
  select count(*) into n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'mykan' and c.relname in ('focus_settings', 'focus_entries') and c.relrowsecurity;
  if n = 2 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] RLS enabled on focus_settings and focus_entries';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] RLS enabled on both focus tables -> ' || n;
  end if;

  -- ── Personal project: one per owner ──────────────────────────────────────
  begin
    insert into mykan.projects (name, key, created_by, is_personal)
      values ('Personal', 'RHFA', ua, true) returning id into p_personal;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] personal project insert';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] personal project insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.projects (name, key, created_by, is_personal)
      values ('Personal again', 'RHFB', ua, true);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] second personal project for the same owner was accepted';
  exception when unique_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] second personal project for the same owner';
  end;

  begin
    insert into mykan.projects (name, key, created_by)
      values ('Work', 'RHFC', ua) returning id into p_work;
    select is_personal into s from mykan.projects where id = p_work;
    if s.is_personal = false then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] an ordinary project defaults to is_personal = false';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] ordinary project is_personal default';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] ordinary project insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  insert into mykan.items (project_id, type) values (p_work, 'epic') returning id into item1;
  insert into mykan.items (project_id, type) values (p_work, 'task') returning id into item2;

  -- ── Settings defaults and checks ─────────────────────────────────────────
  begin
    insert into mykan.focus_settings (user_email) values (ua);
    select * into s from mykan.focus_settings where user_email = ua;
    if s.enabled = false and s.min_entries = 2 and s.max_entries = 7 and s.stale_days = 7
       and s.review_hour = 8 and s.time_zone = 'UTC' and s.last_reviewed_at is null then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] settings defaults (off, 2/7, 7 days, 08:00 UTC)';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] settings defaults';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] settings insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.focus_settings set min_entries = 7, max_entries = 7 where user_email = ua;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] min_entries = max_entries was accepted';
  exception when check_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] min_entries must be below max_entries';
  end;

  begin
    update mykan.focus_settings set review_hour = 24 where user_email = ua;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] review_hour 24 was accepted';
  exception when check_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] review_hour outside 0..23';
  end;

  begin
    update mykan.focus_settings set personal_project_id = p_personal where user_email = ua;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] settings record the personal project';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] settings personal_project_id -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Entries: one active per person per card ──────────────────────────────
  begin
    insert into mykan.focus_entries (user_email, item_id, position) values (ua, item1, 1024) returning id into e_a;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] entry insert';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] entry insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.focus_entries (user_email, item_id, position) values (ua, item1, 2048);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] a second active entry for the same card was accepted';
  exception when unique_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] second active entry for the same person and card';
  end;

  begin
    insert into mykan.focus_entries (user_email, item_id, position) values (ub, item1, 1024) returning id into e_b;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] another person can hold the same card';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] same card, other person -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.focus_entries (user_email, item_id, position, removed_at)
      values (ua, item2, 3072, now()) returning id into e_removed;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] a removed entry is history';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] removed entry insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.focus_entries (user_email, item_id, position, why_now)
      values (ua, item2, 4096, repeat('x', 201));
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] a 201-character why_now was accepted';
  exception when check_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] why_now over 200 characters';
  end;

  begin
    insert into mykan.focus_entries (user_email, item_id, position, completed_at, removed_at)
      values (ua, item2, 4096, now(), now());
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] an entry both completed and removed was accepted';
  exception when check_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] completed and removed at once';
  end;

  -- ── Trigger: moving INTO done completes active entries ───────────────────
  begin
    update mykan.items set status = 'in_progress' where id = item1;
    select count(*) into n from mykan.focus_entries where item_id = item1 and completed_at is not null;
    if n = 0 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] a non-done status change completes nothing';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] in_progress completed ' || n || ' entries';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] status to in_progress -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.items set status = 'done' where id = item1;
    select count(*) into n from mykan.focus_entries where id in (e_a, e_b) and completed_at is not null;
    if n = 2 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] moving into done completes every active entry for the card';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] done completed ' || n || ' of 2 entries';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] status to done -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.items set status = 'done' where id = item2;
    select count(*) into n from mykan.focus_entries where id = e_removed and completed_at is null and removed_at is not null;
    if n = 1 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] a removed entry is left alone when its card is done';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] removed entry was touched';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] removed entry on done -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.items set status = 'new' where id = item1;
    select count(*) into n from mykan.focus_entries where id = e_a and completed_at is not null;
    if n = 1 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] leaving done does not restore the entry';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] leaving done restored the entry';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] status back to new -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.focus_entries (user_email, item_id, position) values (ua, item1, 5120);
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] a completed card can be added again';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] re-add after completion -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Cascades ─────────────────────────────────────────────────────────────
  begin
    delete from mykan.items where id = item1;
    select count(*) into n from mykan.focus_entries where item_id = item1;
    if n = 0 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] deleting a card deletes its focus entries';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] card delete left ' || n || ' entries';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] card delete cascade -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    delete from mykan.projects where id = p_personal;
    select personal_project_id into s from mykan.focus_settings where user_email = ua;
    if s.personal_project_id is null then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] deleting the personal project clears settings.personal_project_id';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] personal project delete left the reference';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] personal project delete -> ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'REHEARSAL RESULTS (rolled back): % pass, % fail%', n_pass, n_fail, r;
end
$rehearsal$;
