-- Manual isolation checks for the xmoney schema. Run it AFTER applying the migration,
-- in the SQL editor (or psql) as the postgres role. It changes nothing: every probe
-- runs inside a DO block that rolls back, and prints PASS / FAIL notices.
-- All checks must print PASS. See docs/SETUP-XCORE.md step "isolation script".

-- 1. anon and authenticated cannot read or write any xmoney table
do $$
declare
  r text;
  t text;
  tables text[] := array['accounts', 'sessions', 'rate_limits', 'records', 'meta', 'ai_usage', 'mail_connections'];
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array tables loop
      begin
        execute format('set local role %I', r);
        execute format('select 1 from xmoney.%I limit 1', t);
        reset role;
        raise notice 'FAIL: % can SELECT xmoney.%', r, t;
      exception when insufficient_privilege then
        reset role;
        raise notice 'PASS: % cannot SELECT xmoney.%', r, t;
      end;
      begin
        execute format('set local role %I', r);
        execute format('insert into xmoney.%I select * from xmoney.%I limit 0', t, t);
        reset role;
        raise notice 'FAIL: % can INSERT into xmoney.%', r, t;
      exception when insufficient_privilege then
        reset role;
        raise notice 'PASS: % cannot INSERT into xmoney.%', r, t;
      end;
    end loop;
  end loop;
end $$;

-- 2. anon and authenticated have no USAGE on the schema
select
  r.rolname,
  has_schema_privilege(r.rolname, 'xmoney', 'USAGE') as has_usage,
  case when has_schema_privilege(r.rolname, 'xmoney', 'USAGE') then 'FAIL' else 'PASS' end as verdict
from pg_roles r
where r.rolname in ('anon', 'authenticated');

-- 3. RLS is enabled on every xmoney table and none has policies
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'xmoney' and p.tablename = c.relname) as policies,
  case when c.relrowsecurity
        and not exists (select 1 from pg_policies p where p.schemaname = 'xmoney' and p.tablename = c.relname)
       then 'PASS' else 'FAIL' end as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'xmoney' and c.relkind = 'r';

-- 4. The schema is NOT among the schemas the REST API exposes.
--    Also check Settings -> API -> "Exposed schemas" in the dashboard (it must not list xmoney).
select
  coalesce(rc.rolconfig::text, '(none)') as authenticator_config,
  case when coalesce(rc.rolconfig::text, '') like '%xmoney%' then 'FAIL' else 'PASS' end as verdict
from (select 1) x
left join (
  select r.rolconfig from pg_roles r where r.rolname = 'authenticator'
) rc on true;

-- 5. The unique email index exists only on xmoney.accounts (no other table of the
--    project was touched). Expect exactly one row, on xmoney.accounts.
select schemaname, tablename, indexname,
       case when schemaname = 'xmoney' and tablename = 'accounts' then 'PASS' else 'FAIL' end as verdict
from pg_indexes
where indexname = 'accounts_email_key';

-- 6. Permissions/policies of other schemas did not change: compare these counts with the
--    numbers you noted BEFORE applying the migration (they must be identical).
select 'policies outside xmoney' as what, count(*) as total
from pg_policies where schemaname <> 'xmoney'
union all
select 'table grants to anon/authenticated outside xmoney', count(*)
from information_schema.role_table_grants
where grantee in ('anon', 'authenticated') and table_schema <> 'xmoney';
