-- Move mykan's tables out of `public` into a dedicated `mykan` schema.
--
-- Context: this Supabase project is shared by several apps, each isolated to
-- its own exposed schema (e.g. `time`, `cockpit`). mykan was the last app still
-- living in `public`; this migration gives it its own `mykan` schema to match.
--
-- Applied live via the Supabase Management API (the service-role key cannot run
-- DDL). After this runs, the PostgREST "exposed schemas" config must include
-- `mykan`, and the app's Supabase client must set `db: { schema: 'mykan' }`.
--
-- Zero-downtime: the move + the transitional `public` compatibility views run in
-- one transaction, so the currently-deployed app (which still queries `public`)
-- keeps working through the deploy. The views are dropped once the new code,
-- pointed at `mykan`, is verified in production (see the teardown block at the
-- bottom — run it only AFTER the deploy is live).

begin;

create schema if not exists mykan;

-- Roles the Data API uses. service_role is what mykan's server-only client
-- authenticates as; anon/authenticated granted for completeness/parity.
grant usage on schema mykan to anon, authenticated, service_role;

-- Move the enum types first (tables reference them by OID, so order is not
-- strictly required, but this keeps everything tidy in one schema).
alter type public.item_type   set schema mykan;
alter type public.item_status set schema mykan;

-- Move the tables. Indexes, constraints, and the items trigger move with them.
alter table public.projects   set schema mykan;
alter table public.items      set schema mykan;
alter table public.categories set schema mykan;

-- Move the trigger function and pin its search_path so its unqualified `items`
-- reference resolves to mykan.items (otherwise inserts would fail post-move).
alter function public.set_item_number() set schema mykan;
alter function mykan.set_item_number() set search_path = mykan, public;

-- Make sure the API roles can read/write the moved tables, plus anything added
-- to this schema later.
grant all on all tables    in schema mykan to anon, authenticated, service_role;
grant all on all sequences in schema mykan to anon, authenticated, service_role;
grant all on all routines  in schema mykan to anon, authenticated, service_role;
alter default privileges in schema mykan grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema mykan grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema mykan grant all on routines  to anon, authenticated, service_role;

-- Transitional compatibility views so the still-deployed app keeps working
-- against `public` until the new code (db.schema = 'mykan') goes live.
-- Auto-updatable single-table views: INSERT/UPDATE/DELETE rewrite to the base
-- table, so the items_set_number trigger and column defaults still fire.
create view public.projects   as select * from mykan.projects;
create view public.items      as select * from mykan.items;
create view public.categories as select * from mykan.categories;
grant all on public.projects, public.items, public.categories
  to anon, authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- TEARDOWN — run ONLY after the new app code is verified live in production.
-- ---------------------------------------------------------------------------
-- drop view if exists public.projects;
-- drop view if exists public.items;
-- drop view if exists public.categories;
