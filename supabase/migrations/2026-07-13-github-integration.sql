-- GitHub integration (KANBAN-20, GH-1): schema foundation for connecting GitHub
-- accounts, storing per-user PATs, and linking projects / areas / items to GitHub.
-- Full design: docs/github-integration.md.
--
-- Encryption: per-user PATs are encrypted app-side with AES-256-GCM (Node crypto)
-- using a KEK held in Vercel env; github_credentials.encrypted_pat holds only the
-- ciphertext (nonce || ciphertext || auth tag, base64). The DB never sees plaintext
-- and the KEK never lives in the DB. (The KEK env var + encrypt/decrypt code land
-- at GH-2 / KANBAN-21; this migration is schema-only.)
--
-- Applied live via the Supabase Management API (the service-role key cannot run DDL).

-- A GitHub account/org, registered once and shared system-wide. Identified by its
-- canonical login (captured from GitHub /user on connect, never user-typed).
create table if not exists mykan.github_accounts (
  id uuid primary key default uuid_generate_v4(),
  login text not null unique,
  created_at timestamptz not null default now(),
  created_by text
);

-- One user's PAT for one account: one row per (mykan user, account). mykan's first
-- user-supplied secret at rest — encrypted_pat holds AES-256-GCM ciphertext ONLY.
-- status flips to 'invalid' when GitHub returns 401/403, so the UI can prompt that
-- user (and only that user) to reconnect, without disturbing anyone else.
create table if not exists mykan.github_credentials (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid not null references mykan.github_accounts (id) on delete cascade,
  user_email text not null,
  encrypted_pat text not null,
  status text not null default 'active' check (status in ('active', 'invalid')),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, user_email)
);
create index if not exists github_credentials_user_idx
  on mykan.github_credentials (user_email);

-- A project pulls from exactly one GitHub account (1:1, global/shared).
alter table mykan.projects add column if not exists github_account_id uuid
  references mykan.github_accounts (id) on delete set null;

-- An area (category node) is bound to one repo within the project's account, as
-- `owner/repo`. This binding IS the import routing target (issues from the repo
-- land as items under this area).
alter table mykan.categories add column if not exists github_repo text;

-- Backlink from an imported item to its source issue, as `owner/repo#number`. The
-- dedupe key for import and the target for Done→close / un-done→reopen write-back.
alter table mykan.items add column if not exists github_issue text;
create index if not exists items_github_issue_idx on mykan.items (github_issue);
