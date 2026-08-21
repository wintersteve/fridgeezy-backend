-- The default skill level follows the difficulty scale down a rung.
--
-- `DIFFICULTY_RULE` was re-placed so that `easy` is the standard version a
-- competent home cook makes, `medium` is a chef-level interpretation and `hard`
-- is what a Michelin-starred kitchen would send out. There is no longer a rung
-- below the real dish.
--
-- `profile_settings.difficulty` did not move with it, and nothing would have
-- reported that. The column defaulted to 'medium' because 'medium' used to MEAN
-- "the standard recipe" — the middle of a scale whose bottom was a beginner's
-- simplification. On the new scale the same literal means restaurant cooking,
-- so every account created since would have opened the app asking for
-- chef-level dishes without anybody choosing that.
--
-- It is not a display preference. `find_recipes` ranks every catalogue read
-- with `difficulty_preference_rank(difficulty, p_difficulty)`, and the chat
-- path feeds the same value in as the DEFAULT difficulty for anything generated
-- that turn. So the wrong default does not merely mislabel a slider: it tilts
-- the whole feed and quietly buys harder generations.
--
-- ## The backfill is safe exactly once, and this is it
--
-- A stored 'medium' cannot be told apart from a chosen 'medium' — the column
-- records the value, not who set it — so rewriting it is guessing at intent,
-- and it is guessing wrong for anybody who deliberately picked the middle rung.
-- That is a real cost the day this table holds real users. It holds ONE row
-- today, on a pre-launch dev project, created by the default it is about to
-- correct. Doing it now costs nothing; doing it later costs somebody's setting.
--
-- Anyone who has genuinely chosen 'hard' keeps it, and anyone who had already
-- chosen 'easy' was already asking for the standard version and still is.
alter table profile_settings
    alter column difficulty set default 'easy'::difficulty_type;

update profile_settings
set difficulty = 'easy'::difficulty_type,
    updated_at = now()
where difficulty = 'medium'::difficulty_type;

comment on column profile_settings.difficulty is
    'The cook''s skill level, on the same scale a recipe''s difficulty uses: '
        'easy is the standard version of a dish, medium a chef-level '
        'interpretation, hard a restaurant plate. Read by the CLIENT and sent '
        'up as a request field — no server code selects this column. It ORDERS '
        'the feed via difficulty_preference_rank and never narrows it.';
