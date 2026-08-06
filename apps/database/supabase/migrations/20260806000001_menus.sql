-- Saved meals, moved off the handset.
--
-- A composed menu used to live only in the app's AsyncStorage (a persisted
-- zustand store), which meant it did not survive a reinstall, did not follow the
-- account to a second device, and was still there for whoever signed in next.
-- Favourites, collections and shopping lists were all already server-side; this
-- brings the last saved object into line with them.

create table if not exists menus
(
    id             uuid primary key                  default gen_random_uuid(),
    profile_id     uuid                     not null references profiles (id) on delete cascade,
    name           text                     not null,
    -- The dish the meal is composed around. Deliberately not a foreign key —
    -- see menu_courses.recipe_id below, which it is one of.
    main_recipe_id uuid                     not null,
    created_at     timestamp with time zone not null default now(),
    updated_at     timestamp with time zone not null default now(),
    -- Re-saving a meal built on the same main replaces it rather than stacking a
    -- near-duplicate. The client has always collapsed these locally; the
    -- constraint is what lets it do so with an upsert instead of a read.
    constraint menus_profile_id_main_recipe_id_key unique (profile_id, main_recipe_id)
);

create index if not exists idx_menus_profile_id on menus using btree (profile_id);

create table if not exists menu_courses
(
    id          uuid primary key                  default gen_random_uuid(),
    menu_id     uuid                     not null references menus (id) on delete cascade,
    -- Points at `recipes` when is_recipe is true and at `recipe_suggestions`
    -- otherwise: the compose flow can fill a course with a suggestion it matched
    -- but never promoted. One column spanning two tables cannot carry a foreign
    -- key, and the snapshot below is what keeps the course renderable either way.
    recipe_id   uuid                     not null,
    is_recipe   boolean                  not null default true,
    course_type text                     not null,
    -- Composition order, kept so a menu reads back the way it was built. The app
    -- sorts by course for display; this is the tiebreak within a course.
    position    integer                  not null default 0,
    -- Snapshot taken at save time. The saved-meal cards render every course
    -- without a second query, and a generated recipe swept up later by
    -- delete_orphan_generated_recipes must not blank the meal that used it.
    name        text                     not null,
    description text,
    difficulty  difficulty_type,
    image       text,
    created_at  timestamp with time zone not null default now()
);

create index if not exists idx_menu_courses_menu_id on menu_courses using btree (menu_id);

alter table menus enable row level security;
alter table menu_courses enable row level security;

create policy users_manage_own_menus on menus for all
    using ((profile_id in (select profiles.id from profiles where (profiles.user_id = auth.uid()))));

-- Reached through the menu, since menu_courses has no profile_id.
create policy users_manage_own_menu_courses on menu_courses for all
    using ((menu_id in (select menus.id
                        from menus
                        where (menus.profile_id in (select profiles.id
                                                    from profiles
                                                    where (profiles.user_id = auth.uid()))))));
