-- A component fills no course, so it carries no course tag.
--
-- `COURSE_RULE` now exempts a building block from the "EXACTLY 1 course tag"
-- requirement every generator states, because that requirement had no honest
-- answer for one: course is the only tag facet with no way to say "not
-- applicable", and it is exactly the facet a béchamel needs one for.
--
-- The model picked a value anyway, and the value was noise. At the time of
-- writing the catalogue held two sauces: `Arrabbiata Sauce` tagged `main` and
-- `Ajvar` tagged `side`. Neither is a fact about the dish, and both were
-- load-bearing — `splitCourses` subtracts the seed's courses from the slots the
-- user asked for, so composing around the arrabbiata could offer anything
-- EXCEPT the pasta it goes on, while the ajvar looked correct by luck.
--
-- A prompt fix cannot reach a row that already exists (dedup RESOLVES to the
-- stored row rather than regenerating it, so a catalogue dish keeps the tags it
-- was written with for as long as it lives), which is why this runs — the same
-- reason `strip-cuisine-from-names` exists.
--
-- Deliberately NOT idempotency-guarded beyond the delete itself being one: a row
-- with no course tag matches nothing and re-running is free.
--
-- What this changes downstream, so it is not a surprise: a component drops out
-- of any `find_recipes` course filter, and out of the course eyebrow on its
-- card. Both are correct — it was only ever in them because of a coin flip —
-- and `recipe_display_tags` still draws its component tag ("Sauce"), which is
-- the chip that actually says what the row is.

-- ## One row first: a component tag that is itself wrong
--
-- This migration deletes a course tag on the strength of a component tag, so a
-- WRONG component tag destroys a RIGHT course tag — and not recoverably, since
-- removing the bad component tag afterwards does not bring the course back.
--
-- `Baba Ganoush` is that row. It is a mezze: you sit down and eat it with
-- bread, which is precisely what COMPONENT_RULE says disqualifies a component
-- tag ("a BUILDING BLOCK rather than something you would sit down and eat").
-- Tagged `sauce`, it would have lost the `appetizer` it correctly carries,
-- dropped out of the appetizer filter, and had its compose control invert to
-- "dishes that use this sauce".
--
-- Named explicitly rather than caught by a rule, because there is no predicate
-- that separates a dip you eat from a sauce you pour — that judgement is the
-- whole content of the component tag, and here the model got it wrong. This is
-- a one-off repair of one known row, the same shape as
-- `strip-cuisine-from-names`, and it runs FIRST so the deletes below never see
-- the row at all.
--
-- A no-op on any database that does not hold it (local, at the time of
-- writing), which is what keeps it safe to run everywhere.

delete from recipe_suggestion_tags st
using tags t
where t.id = st.tag_id
  and t.type = 'component'
  and exists (select 1
              from recipe_suggestions s
              where s.id = st.recipe_suggestion_id
                and lower(btrim(s.name)) = 'baba ganoush');

delete from recipe_tags rt
using tags t
where t.id = rt.tag_id
  and t.type = 'component'
  and exists (select 1
              from recipes r
              where r.id = rt.recipe_id
                and lower(btrim(r.name)) = 'baba ganoush');

-- Now the course tags, for everything still carrying a component tag.

delete from recipe_tags rt
using tags t
where t.id = rt.tag_id
  and t.type = 'course'
  and exists (select 1
              from recipe_tags rt2
                       join tags t2 on t2.id = rt2.tag_id
              where rt2.recipe_id = rt.recipe_id
                and t2.type = 'component');

delete from recipe_suggestion_tags st
using tags t
where t.id = st.tag_id
  and t.type = 'course'
  and exists (select 1
              from recipe_suggestion_tags st2
                       join tags t2 on t2.id = st2.tag_id
              where st2.recipe_suggestion_id = st.recipe_suggestion_id
                and t2.type = 'component');
