-- Rehearsal for supabase/migrations/2026-09-16-3-item-entries.sql (KANBAN-36).
--
-- NOT a migration (the runner only reads supabase/migrations/). Run it in the
-- SAME transaction right after the migration SQL, e.g.
--   begin;
--   <contents of 2026-09-16-3-item-entries.sql>
--   <contents of this file>
--   rollback;
-- It always ends with `raise exception 'REHEARSAL RESULTS (rolled back): ...'`,
-- so the transaction aborts and nothing (migration included) is kept. Read the
-- results out of the error message: every line is
--   PASS|FAIL  [expect OK|REFUSED]  case  -> what happened
-- A FAIL line means the database did not behave as the case label says.
--
-- Throwaway rows: one project, two items (numbers come from the trigger), and
-- entries on them. Each case runs in its own BEGIN/EXCEPTION sub-block, so a
-- refused case rolls back only itself.

do $rehearsal$
declare
  r text := '';
  n_pass int := 0;
  n_fail int := 0;
  pid uuid;
  item1 uuid;
  item2 uuid;
  p1 uuid;          -- progress on item1 (gets superseded)
  p2 uuid;          -- progress on item1, supersedes p1
  p_other uuid;     -- progress on item2
  q1 uuid;          -- question on item1
  d1 uuid;          -- decision on item1
  d_other uuid;     -- decision on item2
  x uuid := gen_random_uuid();
  n int;
  flag boolean;

begin
  insert into mykan.projects (name) values ('REHEARSAL item_entries (rolled back)')
    returning id into pid;
  insert into mykan.items (project_id, type) values (pid, 'task') returning id into item1;
  insert into mykan.items (project_id, type) values (pid, 'task') returning id into item2;

  -- ── Valid inserts per kind (initial states) ──────────────────────────────
  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, created_by)
      values (item1, 'progress', 'current', 'p1', 'mcp', 'rehearsal') returning id into p1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] progress/current insert';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] progress/current insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'question', 'open', 'q1', 'web') returning id into q1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] question/open insert';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] question/open insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'decision', 'active', 'd1', 'telegram') returning id into d1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] decision/active insert';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] decision/active insert -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item2, 'progress', 'current', 'p_other', 'mcp') returning id into p_other;
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item2, 'decision', 'active', 'd_other', 'mcp') returning id into d_other;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] entries on a second item';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] entries on a second item -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'question', 'answered', 'answered without a decision', 'recovery');
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] question/answered with no decision link, source recovery';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] question/answered with no decision link -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Invalid kind/state pairs and columns ─────────────────────────────────
  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'progress', 'open', 'bad', 'mcp');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] progress/open -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] progress/open -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'question', 'superseded', 'bad', 'mcp');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] question/superseded -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] question/superseded -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'decision', 'current', 'bad', 'mcp');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] decision/current -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] decision/current -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'note', 'current', 'bad', 'mcp');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] unknown kind note -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] unknown kind note -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'progress', 'current', E'  \n ', 'mcp');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] blank body -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] blank body -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source)
      values (item1, 'progress', 'current', 'bad', 'email');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] unknown source email -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] unknown source email -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Supersedes ───────────────────────────────────────────────────────────
  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'progress', 'current', 'p2', 'mcp', p1) returning id into p2;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] progress supersedes live progress on same item';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] progress supersedes live progress on same item -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'progress', 'current', 'second successor', 'mcp', p1);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] second live successor of the same entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] second live successor of the same entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set state = 'superseded' where id = p1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] mark older progress superseded';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] mark older progress superseded -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    -- Soft-delete p2 in this sub-block so the unique index can't be what refuses:
    -- the trigger's "already superseded" rule must.
    update mykan.item_entries set deleted_at = now() where id = p2;
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'progress', 'current', 'supersede a superseded', 'mcp', p1);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] superseding an already-superseded entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] superseding an already-superseded entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'progress', 'current', 'cross item', 'mcp', p_other);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] supersedes an entry on another item -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] supersedes an entry on another item -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'decision', 'active', 'cross kind', 'mcp', p2);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] decision supersedes a progress entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] decision supersedes a progress entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'question', 'open', 'question supersedes', 'mcp', q1);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] question with supersedes_id -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] question with supersedes_id -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (id, item_id, kind, state, body, source, supersedes_id)
      values (x, item1, 'progress', 'current', 'self', 'mcp', x);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] supersedes itself -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] supersedes itself -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'progress', 'current', 'dangling', 'mcp', gen_random_uuid());
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] supersedes a nonexistent entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] supersedes a nonexistent entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set supersedes_id = null where id = p2;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] change supersedes_id after insert (cycles impossible) -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] change supersedes_id after insert (cycles impossible) -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set supersedes_id = p2 where id = p1;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] cycle: older entry made to supersede its successor -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] cycle: older entry made to supersede its successor -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set kind = 'decision', state = 'active' where id = p2;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] change kind -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] change kind -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set item_id = item2 where id = q1;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] move entry to another item -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] move entry to another item -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Answered by ──────────────────────────────────────────────────────────
  begin
    update mykan.item_entries set state = 'answered', answered_by_id = d_other where id = q1;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] answered by a decision on another item -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] answered by a decision on another item -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set state = 'answered', answered_by_id = p2 where id = q1;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] answered by a progress entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] answered by a progress entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set state = 'answered', answered_by_id = q1 where id = q1;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] question answered by itself -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] question answered by itself -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set answered_by_id = d1 where id = q1; -- still 'open'
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] open question with a decision link -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] open question with a decision link -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entries (item_id, kind, state, body, source, answered_by_id)
      values (item1, 'decision', 'active', 'decision with answered_by', 'mcp', d1);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] answered_by_id on a non-question -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] answered_by_id on a non-question -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set state = 'answered', answered_by_id = d1 where id = q1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] question answered by a decision on the same item';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] question answered by a decision on the same item -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set state = 'open', answered_by_id = null where id = q1;
    update mykan.item_entries set state = 'answered', answered_by_id = d1 where id = q1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] reopen (clearing the link) and answer again';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] reopen and answer again -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Soft delete ──────────────────────────────────────────────────────────
  begin
    update mykan.item_entries set deleted_by = 'rehearsal' where id = d1; -- deleted_at still null
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] deleted_by without deleted_at -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] deleted_by without deleted_at -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set deleted_at = now(), deleted_by = 'rehearsal' where id = p2;
    update mykan.item_entries set deleted_at = null, deleted_by = null where id = p2;
    update mykan.item_entries set deleted_at = now(), deleted_by = 'rehearsal' where id = p2;
    select count(*) into n from mykan.item_entries where id = p2 and deleted_at is not null;
    if n = 1 then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] soft delete, undelete, delete again (row kept)';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] soft delete round trip -> row count ' || n;
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] soft delete round trip -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set deleted_at = now() where id = d_other;
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item2, 'decision', 'active', 'supersede a deleted one', 'mcp', d_other);
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] superseding a soft-deleted entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] superseding a soft-deleted entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    -- p2 (p1's successor) is soft-deleted, so after reinstating p1 a new live
    -- successor is allowed: the one-live-successor index ignores deleted rows.
    update mykan.item_entries set state = 'current' where id = p1;
    insert into mykan.item_entries (item_id, kind, state, body, source, supersedes_id)
      values (item1, 'progress', 'current', 'p3', 'mcp', p1);
    update mykan.item_entries set state = 'superseded' where id = p1;
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] new successor once the old successor is soft-deleted';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] new successor once the old successor is soft-deleted -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    update mykan.item_entries set deleted_at = null, deleted_by = null where id = p2;
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] undelete a successor while another live successor exists -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] undelete a successor while another live successor exists -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── Versions ─────────────────────────────────────────────────────────────
  begin
    insert into mykan.item_entry_versions (entry_id, snapshot, fields_changed, source, edit_session, created_by)
      values (p1, '{"kind":"progress","body":"p1","state":"current"}', '{state}', 'mcp', null, 'rehearsal');
    insert into mykan.item_entry_versions (entry_id, snapshot, fields_changed, source, edit_session, created_by)
      values (q1, '{"kind":"question","body":"q1","state":"open"}', '{body}', 'web', 'session-1', 'rehearsal');
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] version rows (mcp without session, web with session)';
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] version rows -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entry_versions (entry_id, snapshot, source)
      values (p1, '{}', 'email');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] version with unknown source -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] version with unknown source -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    insert into mykan.item_entry_versions (entry_id, snapshot, source)
      values (gen_random_uuid(), '{}', 'mcp');
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect REFUSED] version for a nonexistent entry -> accepted';
  exception when others then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect REFUSED] version for a nonexistent entry -> ' || sqlstate || ' ' || sqlerrm;
  end;

  -- ── RLS ──────────────────────────────────────────────────────────────────
  select bool_and(c.relrowsecurity) into flag
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'mykan' and c.relname in ('item_entries', 'item_entry_versions');
  select count(*) into n
    from pg_policies where schemaname = 'mykan' and tablename in ('item_entries', 'item_entry_versions');
  if flag and n = 0 then
    n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] RLS enabled on both tables, zero policies';
  else
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] RLS enabled on both tables, zero policies -> rls ' || coalesce(flag::text, 'null') || ', policies ' || n;
  end if;

  -- ── Cascade from item delete ─────────────────────────────────────────────
  begin
    delete from mykan.items where id = item1;
    select count(*) into n from mykan.item_entries where item_id = item1;
    if n = 0 and not exists (
      select 1 from mykan.item_entry_versions where entry_id in (p1, p2, q1, d1)
    ) then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] deleting the item removes its entries (self-linked ones included) and their versions';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] item delete cascade -> ' || n || ' entries left';
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] item delete cascade -> ' || sqlstate || ' ' || sqlerrm;
  end;

  begin
    select count(*) into n from mykan.item_entries where item_id = item2;
    delete from mykan.projects where id = pid;
    if n > 0 and not exists (select 1 from mykan.item_entries where item_id = item2) then
      n_pass := n_pass + 1; r := r || E'\nPASS [expect OK] deleting the project cascades through items to entries';
    else
      n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] project delete cascade -> entries before ' || n;
    end if;
  exception when others then
    n_fail := n_fail + 1; r := r || E'\nFAIL [expect OK] project delete cascade -> ' || sqlstate || ' ' || sqlerrm;
  end;

  raise exception 'REHEARSAL RESULTS (rolled back): % pass, % fail%', n_pass, n_fail, r;
end
$rehearsal$;
