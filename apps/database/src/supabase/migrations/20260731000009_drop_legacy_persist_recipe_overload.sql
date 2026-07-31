-- Drop the pre-`name_en` persist_recipe overload, orphaned since 20260206000003.
--
-- That migration added `p_name_en TEXT default null` with `create or replace`,
-- which does not replace anything when the parameter list changes — it creates a
-- SECOND function. The 15-argument original has been sitting alongside the real
-- one ever since, and the regenerated types still show both.
--
-- Nothing can reach it today (every caller passes p_name_en, which only the newer
-- signature accepts), but the two are ambiguous for any call that supplies just
-- the 15 shared arguments, and PostgREST answers that with
--   Could not choose the best candidate function
-- rather than picking one. Removed so the ambiguity cannot be triggered later.
drop function if exists persist_recipe(
    TEXT, TEXT, difficulty_type, INT, TEXT, TEXT, INT, INT, INT, INT,
    TEXT[], TEXT, JSONB, JSONB, TEXT[]
);
