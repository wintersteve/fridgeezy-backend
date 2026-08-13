-- Stop the default `component` value being drawn as a chip.
--
-- WHY THIS IS NOW WRONG
-- 20260803000007 made this view the one source of truth for the tags a recipe
-- SHOWS, and included `component` on an explicit rationale: the chips and the
-- filter should read the same rows, so anything filterable is displayable.
-- That reasoning held while a component filter existed. It no longer does —
-- the filter was withdrawn (its remaining client plumbing is unreachable and
-- goes with this change), because the distribution makes it useless as a facet:
-- 41 of 47 recipes and 228 of 233 tagged suggestions are `dish`, 26 of the 28
-- vocabulary values are unused, and selecting `dish` returns the entire
-- catalogue. What is left is a chip with no filter behind it.
--
-- WHY ONLY `dish`
-- `dish` is the DEFAULT every generator is told to emit when nothing more
-- specific fits ("EXACTLY 1 component tag per recipe (use \"dish\" for regular
-- finished dishes/meals)" — five prompts say it). A tag that every ordinary row
-- carries by construction describes nothing; on the client it lands in
-- `groupRecipeTags`'s `rest` and pads the `+N` counter, so the reader pays a
-- chip's worth of attention to learn that a recipe is a recipe.
--
-- The other 27 values stay visible, and that asymmetry is the point: "Sauce" on
-- Beurre Blanc is real information precisely BECAUSE it is not the default. Do
-- not generalise this to `t.type <> 'component'`.
--
-- The tag itself is untouched in `recipe_tags`, and must be. It is not
-- decoration — `search-recipe-suggestions.ts` calls it "the one reliable way to
-- tell 'a sauce' from 'a dish that has a sauce in it'", because similarity
-- search cannot: "sauce for apple strudel" scores highest against Apple Strudel
-- itself. Chat's component questions are answered by this column. This
-- migration changes what is DISPLAYED, not what is stored or searchable.
--
-- Matched on `canonical_id`, not `name`: canonical_id is the stable identity,
-- name is display text and free to change.
--
-- `create or replace` is enough — the output columns are unchanged, only the
-- predicate moves.
create or replace view recipe_display_tags as
select rt.recipe_id,
       t.id,
       t.name,
       t.type
from recipe_tags rt
         join tags t on t.id = rt.tag_id
where not (t.type = 'dietary'
    and exists (select 1
                from dietary_rules d
                where d.diet_canonical_id = t.canonical_id))
  and not (t.type = 'component' and t.canonical_id = 'dish')
union
select rd.recipe_id,
       t.id,
       t.name,
       t.type
from recipe_dietary rd
         join tags t
              on t.canonical_id = rd.diet_canonical_id
                  and t.type = 'dietary';

create or replace view recipe_suggestion_display_tags as
select rst.recipe_suggestion_id,
       t.id,
       t.name,
       t.type
from recipe_suggestion_tags rst
         join tags t on t.id = rst.tag_id
where not (t.type = 'dietary'
    and exists (select 1
                from dietary_rules d
                where d.diet_canonical_id = t.canonical_id))
  and not (t.type = 'component' and t.canonical_id = 'dish')
union
select rsd.recipe_suggestion_id,
       t.id,
       t.name,
       t.type
from recipe_suggestion_dietary rsd
         join tags t
              on t.canonical_id = rsd.diet_canonical_id
                  and t.type = 'dietary';
