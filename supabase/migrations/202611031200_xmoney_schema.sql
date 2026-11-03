-- X Money: own schema in the shared x-core project.
-- Review before applying (docs/SETUP-XCORE.md). Nothing here touches `public`,
-- auth.* or any other app's objects. To remove X Money entirely:
--   drop schema xmoney cascade;

create schema if not exists xmoney;

-- Layer 2 of the lockdown: no API role can even see the schema
revoke all on schema xmoney from public, anon, authenticated;
alter default privileges in schema xmoney revoke all on tables from public, anon, authenticated;
alter default privileges in schema xmoney revoke all on sequences from public, anon, authenticated;
alter default privileges in schema xmoney revoke all on functions from public, anon, authenticated;

-- ---------------------------------------------------------------- accounts
create table xmoney.accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  password_salt text not null,
  kdf_params jsonb not null,
  recovery_hash text not null,
  enabled boolean not null default true,
  ai_enabled boolean not null default false,
  monthly_request_cap int,
  monthly_token_cap int,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  constraint accounts_email_normalized check (email = lower(btrim(email)) and char_length(email) <= 254)
);
-- unique only inside this table: an address used by another app of x-core does not collide
create unique index accounts_email_key on xmoney.accounts (email);

-- ---------------------------------------------------------------- sessions
create table xmoney.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references xmoney.accounts (id) on delete cascade,
  refresh_hash text not null,
  prev_refresh_hash text,
  device_id text not null,
  device_label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index sessions_account_idx on xmoney.sessions (account_id);
create index sessions_refresh_idx on xmoney.sessions (refresh_hash);
create index sessions_prev_refresh_idx on xmoney.sessions (prev_refresh_hash) where prev_refresh_hash is not null;

-- ---------------------------------------------------------------- rate limits
create table xmoney.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- ---------------------------------------------------------------- records
create sequence xmoney.record_rev_seq;

create table xmoney.records (
  account_id uuid not null references xmoney.accounts (id) on delete cascade,
  collection text not null,
  id text not null,
  data jsonb not null,
  schema_version int not null default 1,
  rev bigint not null default 0,
  updated_at timestamptz not null default now(),
  client_updated_at timestamptz not null default now(),
  device_id text,
  deleted_at timestamptz,
  primary key (account_id, collection, id),
  constraint records_collection_format check (collection ~ '^[a-z][a-z0-9_]{0,39}$'),
  constraint records_id_format check (id ~ '^[A-Za-z0-9_.:~-]{1,128}$'),
  constraint records_data_size check (octet_length(data::text) <= 262144),
  constraint records_schema_version check (schema_version between 1 and 1000)
);
create index records_account_rev_idx on xmoney.records (account_id, rev);

-- rev and updated_at always come from the SERVER, never from the device clock
create function xmoney.records_before_write() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (
       new.account_id is distinct from old.account_id
    or new.collection is distinct from old.collection
    or new.id is distinct from old.id
  ) then
    raise exception 'xmoney.records: account_id, collection and id are immutable';
  end if;
  new.rev := nextval('xmoney.record_rev_seq');
  new.updated_at := now();
  return new;
end;
$$;

create trigger records_before_write
  before insert or update on xmoney.records
  for each row execute function xmoney.records_before_write();

-- ---------------------------------------------------------------- meta
create table xmoney.meta (
  account_id uuid primary key references xmoney.accounts (id) on delete cascade,
  schema_version int not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- layer 3: RLS on, no policies
alter table xmoney.accounts enable row level security;
alter table xmoney.sessions enable row level security;
alter table xmoney.rate_limits enable row level security;
alter table xmoney.records enable row level security;
alter table xmoney.meta enable row level security;

-- Belt and braces for objects created above (default privileges only cover future ones)
revoke all on all tables in schema xmoney from public, anon, authenticated;
revoke all on all sequences in schema xmoney from public, anon, authenticated;
revoke all on all functions in schema xmoney from public, anon, authenticated;

comment on schema xmoney is 'X Money personal finance app. Accessed only by the xmoney-api edge function over a direct connection.';
