-- X Money 2.18.0: the Gmail connection of smart capture (read only). Everything lives in the xmoney
-- schema of x-core. The refresh token is stored ENCRYPTED (AES-GCM, key = the XMONEY_MAIL_KEY secret of
-- the xmoney-mail function): the database never holds it in the clear and it never reaches the client.
-- The body of an email is never stored here: only the connection, the cursor and the last read time.
-- Same closing in layers as the schema migration: no permissions for anon/authenticated, RLS on with
-- no policies; only the xmoney-mail function (direct Postgres connection) reads and writes it.
-- Applied by Xaviel or on his request (docs/SETUP-CAPTURA.md), never by default.

create table if not exists xmoney.mail_connections (
  account_id uuid primary key references xmoney.accounts (id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail')),
  email text,
  refresh_token_enc text not null,
  connected_at timestamptz not null default now(),
  last_read_at timestamptz,
  cursor_ms bigint not null default 0
);

alter table xmoney.mail_connections enable row level security;

revoke all on xmoney.mail_connections from public, anon, authenticated;
