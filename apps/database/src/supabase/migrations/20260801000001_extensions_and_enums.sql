-- Extensions and enum types.
--
-- This is the consolidated baseline: it replaces 111 incremental migrations
-- with the schema they add up to, read back from the live database rather than
-- replayed from the files (the two had diverged — see 20260801000000_README).

create extension if not exists http with schema extensions;
create extension if not exists vector with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pgsodium;

-- Enum types. Every one is referenced by a table below, so they come first.

do $$ begin
    create type difficulty_type as enum ('easy', 'medium', 'hard');
exception when duplicate_object then null; end $$;

do $$ begin
    create type recipe_interaction_type as enum ('viewed', 'favourite', 'cooked');
exception when duplicate_object then null; end $$;

do $$ begin
    create type tag_type as enum ('dietary', 'component', 'course', 'cuisine');
exception when duplicate_object then null; end $$;

do $$ begin
    create type unit_system as enum ('metric', 'imperial', 'universal');
exception when duplicate_object then null; end $$;

do $$ begin
    create type unit_type as enum ('weight', 'volume', 'count');
exception when duplicate_object then null; end $$;
