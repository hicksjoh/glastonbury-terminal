-- F1++: OAuth 2.0 dynamic client registration + authorization code flow
-- with PKCE for the MCP server. RFC 6749 + 7591 + 7636 + 8414 + 9728.
--
-- Why this migration exists:
--   The /api/mcp route was originally gated by a single static MCP_AUTH_TOKEN
--   bearer. That works for Claude Code CLI (where you can pass arbitrary HTTP
--   headers via `claude mcp add --header`), but Claude.app's web custom-
--   connector flow only supports OAuth 2.0 dynamic client registration. To
--   make the terminal usable from Claude.app web we need a real OAuth
--   server in front of the MCP route.
--
-- Two tables:
--   - oauth_clients holds the client registry: one row per app that wants to
--     talk to /api/mcp (e.g., one row per "Glastonbury Terminal" custom
--     connector in Claude.app).
--   - oauth_codes holds the short-lived authorization codes minted between
--     /api/oauth/authorize and /api/oauth/token.
--
-- Both are RLS-deny-all to anon/authenticated; only the server-side
-- service_role client can read/write. The OAuth endpoints all run through
-- the service-role client in src/lib/oauth/*.

create table if not exists public.oauth_clients (
  id                          uuid         primary key default gen_random_uuid(),
  client_id                   text         not null unique,
  -- Confidential clients: opaque hash of client_secret (sha256-hex). Public
  -- clients (PKCE only): null, with token_endpoint_auth_method='none'.
  client_secret_hash          text,
  client_name                 text         not null,
  redirect_uris               text[]       not null,
  token_endpoint_auth_method  text         not null
                                            check (token_endpoint_auth_method
                                                    in ('none','client_secret_post')),
  scope                       text         not null default 'mcp',
  created_at                  timestamptz  not null default now(),
  metadata                    jsonb        not null default '{}'::jsonb
);

create index if not exists oauth_clients_client_id_idx
  on public.oauth_clients (client_id);

alter table public.oauth_clients enable row level security;
drop policy if exists "deny all to anon" on public.oauth_clients;
create policy "deny all to anon" on public.oauth_clients
  as restrictive for all to anon, authenticated using (false) with check (false);

create table if not exists public.oauth_codes (
  code                  text         primary key,
  client_id             text         not null,
  redirect_uri          text         not null,
  code_challenge        text         not null,
  code_challenge_method text         not null
                                      check (code_challenge_method = 'S256'),
  scope                 text         not null default 'mcp',
  subject               text         not null default 'wes',
  state                 text,
  created_at            timestamptz  not null default now(),
  expires_at            timestamptz  not null,
  used_at               timestamptz
);

create index if not exists oauth_codes_client_id_idx
  on public.oauth_codes (client_id);

alter table public.oauth_codes enable row level security;
drop policy if exists "deny all to anon" on public.oauth_codes;
create policy "deny all to anon" on public.oauth_codes
  as restrictive for all to anon, authenticated using (false) with check (false);
