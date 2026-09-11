-- Put `extensions` on the search path, database-wide.
--
-- 20260801000004, ...05, ...07 and ...08 all declare `embedding vector(1536)`
-- unqualified, and 20260801000001 installs pgvector `with schema extensions`.
-- The local Postgres image ships `search_path = "$user", public, extensions`,
-- so the bare type has always resolved there — and these files had never
-- actually been replayed end to end against a hosted project, which
-- 20260801000001's own header admits: the baseline was read back from the live
-- database rather than replayed from the files. The first real
-- `db reset --linked` therefore stopped dead on migration ...04 with
-- `type "vector" does not exist`, leaving public empty and every later
-- migration behind it unapplied.
--
-- Sorted ahead of the baseline so a reset fixes the path before anything wants
-- the type. Being older than the applied history, it needs `--include-all` the
-- first time it is picked up.

-- Database level, so every connection made after this one inherits it.
--
-- Guarded the way 20260805000002 guards its storage write: a hosted project
-- that refuses the ALTER must not abort the run and block the 89 migrations
-- behind it. The session SET below is what carries the rest of this run, since
-- the CLI applies every migration over one connection.
do
$$
    begin
        execute format(
            'alter database %I set search_path to %s',
            current_database(),
            '"$user", public, extensions'
        );
    exception
        when insufficient_privilege then
            raise notice 'search_path: cannot be set at database level here — the session setting carries this run';
    end
$$;

-- Session level, for the connection this run is already holding.
set search_path to "$user", public, extensions;
