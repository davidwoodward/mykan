-- mykan schema
-- Paste into the Supabase SQL editor (Database → SQL Editor → New query → Run).
-- Idempotent: safe to re-run.
--
-- mykan's objects live in a dedicated `mykan` schema (the shared Supabase project
-- hosts several apps, each isolated to its own exposed schema). The Data API
-- (PostgREST) must have `mykan` in its exposed schemas, and the app client sets
-- db: { schema: 'mykan' } — see lib/supabase-server.ts. To migrate an existing
-- public-schema deployment into `mykan`, use
--   supabase/migrations/2026-06-28-move-to-mykan-schema.sql

create extension if not exists "uuid-ossp";

create schema if not exists mykan;
set search_path to mykan, public;

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create type item_type as enum ('feature', 'bug', 'task', 'idea');
exception when duplicate_object then null;
end $$;
-- 'task' was added after the type already existed on deployed DBs:
alter type item_type add value if not exists 'task' before 'idea';
-- 'epic' groups child items via items.parent_id (KANBAN-41). On a live DB apply
-- supabase/migrations/2026-09-16-1-item-type-epic.sql on its own (ADD VALUE must
-- not share a transaction with a use of the label).
alter type item_type add value if not exists 'epic' before 'feature';

do $$ begin
  create type item_status as enum ('new', 'in_progress', 'blocked', 'done');
exception when duplicate_object then null;
end $$;
-- 'blocked' was added after the type already existed on deployed DBs:
alter type item_status add value if not exists 'blocked' before 'done';
-- 'testing' is a verification gate between In Progress and Done (KANBAN-18):
alter type item_status add value if not exists 'testing' before 'done';

create table if not exists items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  -- An item's content lives entirely in the rich-text `body` (added below). There
  -- is no separate name/title column; any plain-text label is derived from `body`
  -- via richDocText on read. (The legacy `name` column was dropped 2026-06-30,
  -- see supabase/migrations/2026-06-30-drop-item-name.sql.)
  type item_type not null default 'feature',
  status item_status not null default 'new',
  position double precision not null default 1024,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_project_status_position_idx
  on items (project_id, status, position);

-- Authorship: track which whitelisted user created / last updated each row.
-- Stamped from the Auth.js session email by the server-only API routes.
alter table projects add column if not exists created_by text;
alter table projects add column if not exists updated_by text;
alter table items    add column if not exists created_by text;
alter table items    add column if not exists updated_by text;

-- Project privacy: a private project is visible only to its creator (the owner).
-- Default public preserves the shared-pool behaviour. Enforced app-side by the
-- API routes (see lib/api-auth.ts loadProjectForAccess / denyItemAccess).
alter table projects add column if not exists is_private boolean not null default false;
create index if not exists projects_is_private_idx on projects (is_private);

-- Rich-text body for items (Tiptap/ProseMirror document JSON). Inline images are
-- stored in the private "item-images" Storage bucket and referenced by URL, so the
-- JSON here stays small. Created out-of-band:
--   storage bucket "item-images" (private) — see lib/supabase-server.ts ITEM_IMAGES_BUCKET
alter table items add column if not exists body jsonb;

-- Free-form tags per item (normalised lowercase, deduped by the API). The set of
-- available tags is derived as the union across a project's items — there is no
-- separate tags table. GIN index supports tag-membership filters.
alter table items add column if not exists tags text[] not null default '{}';
create index if not exists items_tags_idx on items using gin (tags);

-- Assignees: member emails (the whitelist). Shown in the UI only on shared
-- (non-private) projects. GIN index supports "assigned to X" filters.
alter table items add column if not exists assignees text[] not null default '{}';
create index if not exists items_assignees_idx on items using gin (assignees);

-- Soft delete: the Delete action sets archived_at; archived items are hidden from
-- the normal list/board and shown only in the Archived view, where they can be
-- restored (archived_at = null) or permanently removed (row DELETE).
alter table items add column if not exists archived_at timestamptz;
create index if not exists items_archived_idx on items (project_id, archived_at);

-- File attachments per item: a JSON array of {id, name, content_type, size, path}.
-- Bytes live in the private "item-attachments" Storage bucket keyed by `path`;
-- this array is the metadata (count, list, rename target). Mutated server-side
-- by the /api/items/[id]/attachments routes.
alter table items add column if not exists attachments jsonb not null default '[]';

-- Stable per-project item reference (KEY-number, e.g. AMOS-12). The project
-- "key" is the short prefix; the item "number" is immutable, per-project, and
-- stamped on insert by the items_set_number trigger (every creation path gets
-- one). Full migration incl. backfill:
--   supabase/migrations/2026-06-22-item-reference.sql
alter table projects add column if not exists key text;
alter table items    add column if not exists number integer;
create unique index if not exists items_project_number_idx on items (project_id, number);

create or replace function set_item_number() returns trigger as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext('item_number:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number
    from items where project_id = new.project_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_set_number on items;
create trigger items_set_number
  before insert on items
  for each row execute function set_item_number();

-- Per-project hierarchical categories (Areas). A node references its parent
-- (depth capped app-side at 5); an item is filed at one node. Renaming ripples
-- via the id reference; filtering can include a node's whole subtree.
-- Migration: supabase/migrations/2026-06-22-categories.sql
create table if not exists categories (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references categories(id) on delete cascade,
  name text not null,
  position double precision not null default 1024,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);
create index if not exists categories_project_idx on categories (project_id);
create index if not exists categories_parent_idx on categories (parent_id);

alter table items add column if not exists category_id uuid
  references categories(id) on delete set null;
create index if not exists items_category_idx on items (category_id);

-- Epic parent/child links (KANBAN-41). The link is stored once, on the child;
-- an epic's children are derived (items where parent_id = epic.id). Guards live
-- in the items_enforce_parent_link trigger: one level only (an epic has no
-- parent, a child is never an epic), same project only, the parent must be an
-- epic, and an epic can't change type or project while it has children. Deleting
-- an epic un-links its children (on delete set null). Archived items keep their
-- links; the app excludes archived children from counts and won't offer an
-- archived epic as a new parent.
-- Migration: supabase/migrations/2026-09-16-2-item-parent-links.sql
alter table items add column if not exists parent_id uuid
  references items (id) on delete set null;
do $$ begin
  alter table items
    add constraint items_parent_not_self check (parent_id is null or parent_id <> id);
exception when duplicate_object then null;
end $$;
create index if not exists items_parent_idx on items (parent_id);

create or replace function items_enforce_parent_link() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
declare
  p record;
begin
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

drop trigger if exists items_enforce_parent_link on items;
create trigger items_enforce_parent_link
  before insert or update of parent_id, type, project_id on items
  for each row execute function items_enforce_parent_link();

-- Item history (KANBAN-10): whole-item version snapshots. Every field mutation
-- routes through snapshotThenWrite (lib/item-history.ts), which records the
-- item's PREVIOUS state before applying the patch. `fields_changed` names the
-- tracked fields the following write modified — it drives the history panel's
-- change summaries and the body-burst coalescing rule.
-- Migration: supabase/migrations/2026-07-07-item-versions.sql
create table if not exists item_versions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items (id) on delete cascade,
  snapshot jsonb not null,
  fields_changed text[] not null default '{}',
  source text not null check (source in ('web', 'mcp', 'telegram', 'recovery')),
  created_at timestamptz not null default now(),
  created_by text
);
-- Editor session id (minted per editor open): body autosaves coalesce into one
-- history entry only within a session, so dismissing the editor seals the
-- entry. Null (MCP/Telegram/recovery) never coalesces.
-- Migration: supabase/migrations/2026-07-08-item-versions-edit-session.sql
alter table item_versions add column if not exists edit_session text;
create index if not exists item_versions_item_created_idx
  on item_versions (item_id, created_at desc);

-- GitHub integration (KANBAN-19/20). A GitHub account is a global entity; a
-- per-user PAT is the credential that reaches it; projects/areas/items link to
-- GitHub. Full design: docs/github-integration.md.
-- Migration: supabase/migrations/2026-07-13-github-integration.sql
--
-- A GitHub account/org, registered once and shared system-wide, identified by its
-- canonical login (captured from GitHub /user on connect, never user-typed).
create table if not exists github_accounts (
  id uuid primary key default uuid_generate_v4(),
  login text not null unique,
  created_at timestamptz not null default now(),
  created_by text
);

-- One user's PAT for one account: one row per (mykan user, account). mykan's first
-- user-supplied secret at rest — encrypted_pat holds AES-256-GCM ciphertext ONLY
-- (encrypt/decrypt happen app-side with a KEK in Vercel env; the DB never sees
-- plaintext and the KEK never lives in the DB). status flips to 'invalid' on a
-- GitHub 401/403 so the UI can prompt that user alone to reconnect.
create table if not exists github_credentials (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references github_accounts (id) on delete cascade,
  user_email text not null,
  encrypted_pat text not null,
  status text not null default 'active' check (status in ('active', 'invalid')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, user_email)
);
create index if not exists github_credentials_user_idx
  on github_credentials (user_email);

-- A project pulls from exactly one GitHub account (1:1, global/shared).
alter table projects add column if not exists github_account_id uuid
  references github_accounts (id) on delete set null;

-- An area (category node) is bound to one repo within the project's account, as
-- `owner/repo`. This binding IS the import routing target.
alter table categories add column if not exists github_repo text;

-- Backlink from an imported item to its source issue, as `owner/repo#number` — the
-- dedupe key for import and the target for Done→close / un-done→reopen write-back.
alter table items add column if not exists github_issue text;
create index if not exists items_github_issue_idx on items (github_issue);

-- Write-back sync flag (KANBAN-24): the linked issue could not be reconciled to the
-- item's Done state. null = in sync; 'no_pat' = actor has no usable PAT; 'failed' =
-- GitHub rejected/was unreachable (retry-able). A status change is never blocked or
-- rolled back on write-back failure — this flag is how it surfaces instead.
alter table items add column if not exists github_sync text
  check (github_sync in ('no_pat', 'failed'));

-- GitHub provenance shown on a linked item (KANBAN-24): when the source issue was
-- opened on GitHub (github_issue_created_at) and when it was pulled into mykan
-- (github_imported_at). A linked item only re-syncs from GitHub via a manual
-- refresh, which re-captures github_issue_created_at.
alter table items add column if not exists github_issue_created_at timestamptz;
alter table items add column if not exists github_imported_at timestamptz;

-- Per-user MCP tokens (KANBAN-30, Phase I.5a): a per-user bearer replaces the
-- single shared MYKAN_SERVICE_API_KEY so each MCP call maps token → user → PAT.
-- Only a SHA-256 hash of the token is stored (never the plaintext `mk_…` value,
-- which is shown once at creation). Revocable (revoked_at) and expirable
-- (expires_at); the verify path re-checks whitelist membership every call.
-- Migration: supabase/migrations/2026-07-14-mcp-tokens.sql
create table if not exists mcp_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_email text not null,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mcp_tokens_user_idx on mcp_tokens (user_email);

-- Applied-migration ledger for `npm run db:migrate` (scripts/migrate.mjs). One
-- row per file in supabase/migrations/ that has run, with a checksum so an
-- edit-after-apply is detectable.
create table if not exists schema_migrations (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

-- Row-Level Security ─────────────────────────────────────────────────────────
-- Auth is enforced at the app layer (Auth.js + email whitelist), and every
-- server-only API route reaches Supabase with the service-role key, which
-- bypasses RLS. But `mykan` is an exposed PostgREST schema, so with RLS off
-- these tables were readable and writable by anyone presenting the anon key —
-- which is a public value by design, not a control. Supabase's Security Advisor
-- flagged all 7 as `rls_disabled_in_public` (CRITICAL, 2026-07-26).
--
-- Enabled WITH NO POLICIES, deliberately: that is a deny-all for the anon and
-- authenticated roles and a no-op for the app, since service_role is exempt.
-- The advisor reports this as `rls_enabled_no_policy` (INFO) — that is the
-- intended end state, matching the sibling cockpit/fin/helm schemas, not a
-- finding to "fix" by adding permissive policies.
--
-- If a browser-side Supabase client using the anon key is ever added, each
-- table needs real policies at that point. Enabling RLS now is what makes that
-- a deliberate, additive step rather than a silent hole.
-- Migration: supabase/migrations/2026-07-28-enable-rls.sql
alter table projects           enable row level security;
alter table items              enable row level security;
alter table categories         enable row level security;
alter table item_versions      enable row level security;
alter table github_accounts    enable row level security;
alter table github_credentials enable row level security;
alter table mcp_tokens         enable row level security;
alter table schema_migrations  enable row level security;
