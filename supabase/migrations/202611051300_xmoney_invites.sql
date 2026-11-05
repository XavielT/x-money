-- X Money 2.18.5: one-time invite codes, made by the owner (the first account) in Settings.
-- Only the SHA-256 of a code is stored, never the code. Same closing in layers as the schema migration:
-- no permissions for anon/authenticated, RLS on with no policies; only xmoney-api reads and writes it.
-- Applied by Xaviel or on his request, never by default.

create table if not exists xmoney.invites (
  code_hash text primary key,
  created_by uuid not null references xmoney.accounts (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists invites_created_by_idx on xmoney.invites (created_by, used_at);

alter table xmoney.invites enable row level security;

revoke all on xmoney.invites from public, anon, authenticated;
