-- Live-state introspection. Run in the Supabase dashboard SQL editor.
--
-- Why this exists: schema.sql is hand-maintained and drifts the moment anything
-- changes in the dashboard. By 2026-08-29 it had silently fallen three changes
-- behind — it still called discussions "PENDING" after they had shipped, still
-- showed a superseded messages_update_own, and listed four realtime tables when
-- there were seven.
--
-- It also catches what reading SQL cannot. The groups-bucket insert policy read
-- correctly in the file but Postgres had resolved a bare `name` inside its
-- subquery to groups.name rather than storage.objects.name, which made the
-- check bucket-only. pg_policies prints the resolution, so the bug was visible
-- here and nowhere else.
--
-- Usage: run it, click the single result cell, copy the whole value, and hand
-- the JSON to whoever is updating schema.sql (or paste it to Claude and ask it
-- to fold the diff in).
--
-- Reads structure only: policies, function bodies, grants, constraints. No table
-- rows, no user data. The webhook secret is redacted below before it leaves the
-- database -- notify_webhook() carries the real value as a string literal, and
-- an unredacted dump committed to git would leak it permanently.

select jsonb_build_object(
  'captured_at', now(),
  'pg_version', current_setting('server_version'),

  -- A table with rls=false and any grant to anon/authenticated is world-open,
  -- whatever policies it carries.
  'rls', coalesce((select jsonb_agg(jsonb_build_object(
      't', n.nspname||'.'||c.relname, 'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity)
      order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname in ('public','storage')), '[]'::jsonb),

  -- The bodies are the point: `using` and `check` as Postgres resolved them,
  -- not as they were typed.
  'policies', coalesce((select jsonb_agg(jsonb_build_object(
      't', schemaname||'.'||tablename, 'name', policyname, 'cmd', cmd,
      'roles', roles, 'permissive', permissive,
      'using', qual, 'check', with_check)
      order by tablename, policyname)
    from pg_policies where schemaname in ('public','storage')), '[]'::jsonb),

  -- security_definer with a missing search_path is the classic escalation
  -- shape, so both sit beside the body. Extension-owned functions are skipped.
  'functions', coalesce((select jsonb_agg(jsonb_build_object(
      'f', n.nspname||'.'||p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'definer', p.prosecdef,
      'config', p.proconfig,
      'vol', case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end,
      'def', regexp_replace(
               pg_get_functiondef(p.oid),
               $q$('x-webhook-secret'\s*,\s*)'[^']*'$q$,
               $r$\1'<REDACTED>'$r$, 'g'))
      order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), '[]'::jsonb),

  -- The key-freezing guards, rate limits and webhooks. Internal constraint
  -- triggers are excluded: they are FK plumbing, not rules.
  'triggers', coalesce((select jsonb_agg(jsonb_build_object(
      't', n.nspname||'.'||c.relname, 'name', tg.tgname,
      'enabled', tg.tgenabled, 'def', pg_get_triggerdef(tg.oid))
      order by c.relname, tg.tgname)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not tg.tgisinternal and n.nspname in ('public','storage')), '[]'::jsonb),

  -- RLS only gates rows. A table with no grant is unreachable; one with a grant
  -- leans entirely on RLS.
  'table_grants', coalesce((select jsonb_agg(jsonb_build_object('t', tbl, 'g', grantee, 'p', privs))
    from (
      select n.nspname||'.'||c.relname as tbl,
             a.grantee::regrole::text as grantee,
             jsonb_agg(distinct a.privilege_type) as privs
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.relkind = 'r' and n.nspname in ('public','storage')
        and a.grantee::regrole::text in ('anon','authenticated')
      group by 1, 2
    ) s), '[]'::jsonb),

  -- attacl is null unless an explicit column grant exists, so this shows only
  -- the deliberate ones -- i.e. how groups.invite_code is withheld. If a
  -- table-level SELECT grant on groups ever reappears it re-exposes every
  -- column and this list stops meaning anything.
  'column_grants', coalesce((select jsonb_agg(jsonb_build_object(
      't', n.nspname||'.'||c.relname, 'col', att.attname, 'acl', att.attacl::text)
      order by c.relname, att.attname)
    from pg_attribute att
    join pg_class c on c.oid = att.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where att.attacl is not null and n.nspname in ('public','storage')), '[]'::jsonb),

  -- anon holding EXECUTE on a definer function is how an unauthenticated caller
  -- reaches past RLS.
  'function_grants', coalesce((select jsonb_agg(jsonb_build_object('f', fn, 'g', g))
    from (
      select distinct n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as fn,
             a.grantee::regrole::text as g
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ('public','private') and a.privilege_type = 'EXECUTE'
        and a.grantee::regrole::text in ('anon','authenticated')
    ) s), '[]'::jsonb),

  -- public=true makes every object in a bucket world-readable by URL, whatever
  -- the policies on storage.objects say.
  'buckets', coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'public', public, 'size_limit', file_size_limit) order by id)
    from storage.buckets), '[]'::jsonb),

  -- Realtime re-checks the SELECT policy per subscriber, so a table here with a
  -- loose select policy leaks live rather than only on request.
  'realtime', coalesce((select jsonb_agg(schemaname||'.'||tablename order by tablename)
    from pg_publication_tables where pubname = 'supabase_realtime'), '[]'::jsonb),

  -- Every constraint kind, not just checks: primary keys, foreign keys and
  -- uniques are half of what a table definition means.
  'constraints', coalesce((select jsonb_agg(jsonb_build_object(
      't', rel.relname, 'name', con.conname, 'kind', con.contype,
      'def', pg_get_constraintdef(con.oid))
      order by rel.relname, con.conname)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public'), '[]'::jsonb),

  -- Column DDL and indexes. Without these the mirror's table definitions are
  -- transcribed rather than observed, which is the one part of schema.sql that
  -- could drift without anything noticing.
  'columns', coalesce((select jsonb_agg(jsonb_build_object(
      't', c.relname, 'col', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notnull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid))
      order by c.relname, a.attnum)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r'
      and a.attnum > 0 and not a.attisdropped), '[]'::jsonb),

  'indexes', coalesce((select jsonb_agg(jsonb_build_object(
      't', tablename, 'name', indexname, 'def', indexdef)
      order by tablename, indexname)
    from pg_indexes where schemaname = 'public'), '[]'::jsonb),

  -- ensure_rls lives here. Disabled, and new tables stop getting RLS turned on.
  'event_triggers', coalesce((select jsonb_agg(jsonb_build_object(
      'name', evtname, 'event', evtevent, 'enabled', evtenabled, 'fn', evtfoid::regproc::text)
      order by evtname)
    from pg_event_trigger), '[]'::jsonb)

)::text as live_state;
