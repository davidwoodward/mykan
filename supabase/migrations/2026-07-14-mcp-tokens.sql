-- Per-user MCP tokens (KANBAN-30, Phase I.5a). Replaces the single shared
-- MYKAN_SERVICE_API_KEY identity: each MCP call now carries a per-user bearer
-- token that resolves to a specific whitelisted user → their GitHub PAT (no
-- credential borrowing). Full design: docs/github-integration.md §MCP.
--
-- The token is a user secret at rest, so — like the GitHub PAT store — the DB
-- holds only a HASH (SHA-256 hex of the presented bearer), never the plaintext.
-- The plaintext `mk_…` value is shown to the user exactly once at creation and
-- is unrecoverable thereafter. A row can be revoked (revoked_at) or expire
-- (expires_at); the verify path rejects revoked/expired tokens and re-checks
-- whitelist membership on every call.
--
-- Applied live via the Supabase Management API (the service-role key cannot run
-- DDL). Additive-only: a brand-new table, zero impact on existing rows.
create table if not exists mykan.mcp_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_email text not null,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);

-- Verify hashes by exact match (the unique constraint already indexes token_hash);
-- this index serves the settings UI listing a user's own tokens.
create index if not exists mcp_tokens_user_idx on mykan.mcp_tokens (user_email);

-- Expose the new table through PostgREST immediately.
notify pgrst, 'reload schema';
