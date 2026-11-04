-- X Money 2.16.0: AI usage log. Everything lives in the xmoney schema of x-core.
-- It stores counts and tokens, NEVER the content of a request or an answer.
-- Same closing in layers as the schema migration: no permissions for anon/authenticated, RLS on with
-- no policies; only the xmoney-ai function (direct Postgres connection) reads and writes it.
-- Applied by Xaviel (docs/SETUP-XCORE.md), never by Claude Code.

create table if not exists xmoney.ai_usage (
  id bigint generated always as identity primary key,
  account_id uuid not null references xmoney.accounts (id) on delete cascade,
  feature text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  est_cost_usd numeric,
  status text not null check (status in ('ok', 'timeout', 'provider_error', 'rate_limited')),
  latency_ms int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_account_month_idx on xmoney.ai_usage (account_id, created_at desc);

alter table xmoney.ai_usage enable row level security;

revoke all on xmoney.ai_usage from public, anon, authenticated;
revoke all on all sequences in schema xmoney from public, anon, authenticated;
