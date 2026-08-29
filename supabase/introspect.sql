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
--
-- What this still cannot see, so schema.sql must not claim it:
--   * Auth settings (JWT expiry, OTP rate limits, providers) -- dashboard config.
--   * Edge function source -- supabase/functions/, deployed separately.
--   * pg_cron schedules. A reference to cron.job fails to parse when the
--     extension is absent, so it cannot live in this query. If 'extensions'
--     below lists pg_cron, run `select * from cron.job;` as a second query.

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
  -- grantee 0 is PUBLIC, which reaches anon and authenticated alike. Filtering
  -- it out would hide the broadest grant there is, so it is named instead.
  'table_grants', coalesce((select jsonb_agg(jsonb_build_object('t', tbl, 'g', grantee, 'p', privs))
    from (
      select n.nspname||'.'||c.relname as tbl,
             case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
             jsonb_agg(distinct a.privilege_type) as privs
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      where c.relkind in ('r','p','v','m') and n.nspname in ('public','private','storage')
        and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'))
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
  -- reaches past RLS. PUBLIC is included and is the one that bites: Postgres
  -- grants EXECUTE to PUBLIC by default, so a function nobody revoked has a
  -- null proacl and acldefault fills in that grant. Dropping grantee 0 would
  -- print such a function as reachable by no one.
  'function_grants', coalesce((select jsonb_agg(jsonb_build_object('f', fn, 'g', g))
    from (
      select distinct n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as fn,
             case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as g
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ('public','private') and a.privilege_type = 'EXECUTE'
        and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'))
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    ) s), '[]'::jsonb),

  -- EXECUTE means nothing without USAGE on the schema holding the function.
  -- This is the actual gate keeping private.* off the PostgREST surface, and
  -- schema.sql asserts it ("never exposed as RPCs") without ever having read it.
  'schema_grants', coalesce((select jsonb_agg(jsonb_build_object(
      's', n.nspname,
      'g', case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
      'p', a.privilege_type) order by n.nspname)
    from pg_namespace n
    cross join lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
    where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'
      and (a.grantee = 0 or a.grantee::regrole::text in ('anon','authenticated'))), '[]'::jsonb),

  -- What a table created tomorrow inherits before anyone writes a grant.
  'default_privileges', coalesce((select jsonb_agg(jsonb_build_object(
      'role', d.defaclrole::regrole::text,
      'schema', coalesce(n.nspname, '(all)'),
      'objtype', d.defaclobjtype::text,
      'acl', d.defaclacl::text))
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace), '[]'::jsonb),

  -- public=true makes every object in a bucket world-readable by URL, whatever
  -- the policies on storage.objects say. Whole row rather than three columns:
  -- allowed_mime_types is half of what bounds an upload, and picking columns by
  -- hand is how it went uncaptured while schema.sql claimed it was verified.
  'buckets', coalesce((select jsonb_agg(to_jsonb(b) order by b.id)
    from storage.buckets b), '[]'::jsonb),

  -- Realtime re-checks the SELECT policy per subscriber, so a table here with a
  -- loose select policy leaks live rather than only on request.
  'realtime', coalesce((select jsonb_agg(schemaname||'.'||tablename order by tablename)
    from pg_publication_tables where pubname = 'supabase_realtime'), '[]'::jsonb),

  -- Which publications exist and which operations each carries. A table in the
  -- publication with pubupdate=false streams inserts and nothing else.
  'publications', coalesce((select jsonb_agg(jsonb_build_object(
      'name', pubname, 'all_tables', puballtables,
      'ins', pubinsert, 'upd', pubupdate, 'del', pubdelete, 'trunc', pubtruncate)
      order by pubname)
    from pg_publication), '[]'::jsonb),

  -- Replica identity decides what an UPDATE or DELETE payload carries. On the
  -- default setting a delete event names only the primary key, so a client that
  -- filters realtime on any other column silently misses deletes.
  'replica_identity', coalesce((select jsonb_agg(jsonb_build_object(
      't', c.relname,
      'ri', case c.relreplident when 'd' then 'default' when 'n' then 'nothing'
                                when 'f' then 'full' when 'i' then 'index' end)
      order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r' and n.nspname = 'public'), '[]'::jsonb),

  -- Every constraint kind, not just checks: primary keys, foreign keys and
  -- uniques are half of what a table definition means. convalidated is the
  -- point of the "all VALIDATED" line in schema.sql: a NOT VALID check is
  -- enforced on new rows only and reads identically in pg_get_constraintdef.
  'constraints', coalesce((select jsonb_agg(jsonb_build_object(
      't', n.nspname||'.'||rel.relname, 'name', con.conname, 'kind', con.contype,
      'valid', con.convalidated, 'deferrable', con.condeferrable,
      'def', pg_get_constraintdef(con.oid))
      order by rel.relname, con.conname)
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname in ('public','private','storage')), '[]'::jsonb),

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
    from pg_event_trigger), '[]'::jsonb),

  -- Everything below answers "is there something here nobody wrote down".
  -- The blocks above all take a fixed list of schemas and object kinds as
  -- given, so anything outside those lists cannot appear in the capture at all
  -- -- and an object that cannot appear is one schema.sql will never mention.

  -- A schema nobody expected is the cheapest possible tell.
  'schemas', coalesce((select jsonb_agg(n.nspname order by n.nspname)
    from pg_namespace n
    where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'), '[]'::jsonb),

  -- Every relation of every kind, so a table missing from schema.sql shows up
  -- as a name with no counterpart rather than as silence. Views are included
  -- because a view is not covered by the owning table's RLS unless it was
  -- created with security_invoker -- which is in reloptions, printed below.
  'relations', coalesce((select jsonb_agg(jsonb_build_object(
      'r', n.nspname||'.'||c.relname, 'kind', c.relkind::text,
      'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity,
      'owner', c.relowner::regrole::text, 'opts', to_jsonb(c.reloptions))
      order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','f')), '[]'::jsonb),

  'view_defs', coalesce((select jsonb_agg(jsonb_build_object(
      'v', n.nspname||'.'||c.relname,
      'kind', case c.relkind when 'm' then 'matview' else 'view' end,
      'def', pg_get_viewdef(c.oid, true))
      order by n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v','m') and n.nspname in ('public','private')), '[]'::jsonb),

  -- Enums, domains and their checks. This project spells its enums as text plus
  -- a check constraint, so an entry here means someone changed approach.
  'types', coalesce((select jsonb_agg(jsonb_build_object(
      'name', n.nspname||'.'||t.typname, 'kind', t.typtype::text,
      'labels', (select jsonb_agg(e.enumlabel order by e.enumsortorder)
                 from pg_enum e where e.enumtypid = t.oid),
      'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
      'checks', (select jsonb_agg(pg_get_constraintdef(cc.oid))
                 from pg_constraint cc where cc.contypid = t.oid))
      order by n.nspname, t.typname)
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public','private') and t.typtype in ('e','d','r','c')
      and not exists (select 1 from pg_class c2 where c2.oid = t.typrelid and c2.relkind <> 'c')
      and not exists (select 1 from pg_depend d2 where d2.objid = t.oid and d2.deptype = 'e')), '[]'::jsonb),

  'sequences', coalesce((select jsonb_agg(jsonb_build_object(
      's', schemaname||'.'||sequencename, 'type', data_type::text,
      'start', start_value, 'inc', increment_by, 'cycle', cycle) order by sequencename)
    from pg_sequences where schemaname in ('public','private')), '[]'::jsonb),

  -- Identity and generated columns. Only the columns that have one, so this
  -- stays empty on a schema like this one rather than repeating the column list.
  'column_extras', coalesce((select jsonb_agg(jsonb_build_object(
      't', c.relname, 'col', a.attname,
      'identity', a.attidentity::text, 'generated', a.attgenerated::text)
      order by c.relname, a.attnum)
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      and (a.attidentity <> '' or a.attgenerated <> '')), '[]'::jsonb),

  'extensions', coalesce((select jsonb_agg(jsonb_build_object(
      'name', e.extname, 'ver', e.extversion, 'schema', n.nspname) order by e.extname)
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace), '[]'::jsonb),

  -- The triggers block above stops at public and storage, so a trigger on
  -- auth.users -- the standard place to hang new-user setup, and a path into
  -- public that no policy governs -- would not be in the capture at all.
  'other_triggers', coalesce((select jsonb_agg(jsonb_build_object(
      't', n.nspname||'.'||c.relname, 'name', tg.tgname,
      'enabled', tg.tgenabled, 'def', pg_get_triggerdef(tg.oid))
      order by n.nspname, c.relname, tg.tgname)
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not tg.tgisinternal
      and n.nspname not in ('public','storage','pg_catalog','information_schema')), '[]'::jsonb),

  -- Functions in a schema that is neither ours nor Supabase's. Names and
  -- flags only: the bodies of the managed schemas would swamp the capture.
  'foreign_schema_functions', coalesce((select jsonb_agg(jsonb_build_object(
      'f', n.nspname||'.'||p.proname, 'args', pg_get_function_identity_arguments(p.oid),
      'definer', p.prosecdef, 'config', p.proconfig, 'owner', p.proowner::regrole::text)
      order by n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname not like 'pg\_%'
      and n.nspname not in ('public','private','information_schema','auth','storage',
                            'realtime','graphql','graphql_public','extensions','vault',
                            'pgbouncer','supabase_migrations','supabase_functions',
                            'net','cron','pgsodium','pgsodium_masks','_realtime','_analytics')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), '[]'::jsonb),

  'comments', coalesce((select jsonb_agg(x)
    from (
      select jsonb_build_object('obj', n.nspname||'.'||c.relname,
                                'col', a.attname, 'txt', d.description) as x
      from pg_description d
      join pg_class c on c.oid = d.objoid and d.classoid = 'pg_class'::regclass
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid
      where n.nspname in ('public','private')
      union all
      select jsonb_build_object('obj', n.nspname||'.'||p.proname,
                                'col', null, 'txt', d.description)
      from pg_description d
      join pg_proc p on p.oid = d.objoid and d.classoid = 'pg_proc'::regclass
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private')
    ) s), '[]'::jsonb)

)::text as live_state;
