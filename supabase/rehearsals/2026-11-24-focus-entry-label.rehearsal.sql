-- Rehearsal for supabase/migrations/2026-11-24-2-focus-entry-label.sql (KANBAN-82).
-- Run in the same transaction right after the migration; always ends with
-- `raise exception 'REHEARSAL RESULTS (rolled back): ...'` so nothing is kept.

do $rehearsal$
declare
  r text := '';
  n_pass int := 0;
  n_fail int := 0;
  p uuid;
  it uuid;
  e uuid;
begin
  insert into mykan.projects (name, key, created_by) values ('Rehearsal', 'RHLA', 'rehearsal@example.invalid') returning id into p;
  insert into mykan.items (project_id, type) values (p, 'task') returning id into it;

  begin
    insert into mykan.focus_entries (user_email, item_id, position, label)
      values ('rehearsal@example.invalid', it, 1024, 'My own words') returning id into e;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] entry with a label';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] entry with a label -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.focus_entries set label = null where id = e;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] label can be cleared (falls back to the card title)';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] clear label -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.focus_entries set label = '' where id = e;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] empty label was accepted';
  exception when check_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] empty label';
  end;

  begin
    update mykan.focus_entries set label = repeat('x', 201) where id = e;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] 201-character label was accepted';
  exception when check_violation then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] label over 200 characters';
  end;

  raise exception 'REHEARSAL RESULTS (rolled back): % pass, % fail%', n_pass, n_fail, r;
end
$rehearsal$;
