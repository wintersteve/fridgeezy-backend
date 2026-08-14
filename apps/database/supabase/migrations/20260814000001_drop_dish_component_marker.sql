-- Drop the `dish` component marker: absence now means "this is a finished dish".
--
-- WHY
-- Every generator used to demand EXACTLY ONE component tag and name `dish` as
-- the catch-all when nothing more specific fit. The result was 269 rows (41
-- recipes, 228 suggestions — 87% of the catalogue) carrying a tag that asserts a
-- recipe is a recipe. It described nothing, padded the `+N` chip counter on every
-- card until 20260813000002 filtered it out of the display views, and forced
-- every "is this a component?" test to be spelled `!= 'dish'` rather than a plain
-- EXISTS.
--
-- The prompts now write a component tag ONLY for a genuine building block
-- (COMPONENT_RULE in `tagging-rules.ts`), so this deletes the rows that the old
-- rule produced. Without the delete, absence would be ambiguous — "not a
-- component" for new rows, and nothing at all for old ones — which is exactly the
-- state a half-done migration leaves behind.
--
-- WHAT IS NOT TOUCHED
-- The other 27 component values stay, and so do the 6 rows carrying them
-- (`sauce` on Beurre Blanc, Mala Oil, Toum). They are the reason the type exists:
-- `search-recipe-suggestions` calls the component tag "the one reliable way to
-- tell 'a sauce' from 'a dish that has a sauce in it'", because similarity search
-- cannot — "sauce for apple strudel" scores highest against Apple Strudel itself.
-- Chat's component questions are answered from those rows.
--
-- ORDER MATTERS: the join rows go first. `tags.id` is referenced by
-- `recipe_tags.tag_id` and `recipe_suggestion_tags.tag_id`, so deleting the tag
-- row first either fails on the constraint or cascades — and a cascade would do
-- the same work silently, which is worse than doing it visibly.
delete from recipe_tags rt
    using tags t
where t.id = rt.tag_id
  and t.type = 'component'
  and t.canonical_id = 'dish';

delete from recipe_suggestion_tags rst
    using tags t
where t.id = rst.tag_id
  and t.type = 'component'
  and t.canonical_id = 'dish';

-- The vocabulary row itself. Removed rather than left in place: it is offered to
-- the recipe generators as part of the approved tag list (`fetchRecipeMetadata`
-- selects every tag with no type filter), so leaving it would keep handing the
-- model the exact value the new rule tells it not to use.
delete
from tags
where type = 'component'
  and canonical_id = 'dish';

-- NOTE for whoever reads 20260813000002 next: its display-view predicate
-- (`not (t.type = 'component' and t.canonical_id = 'dish')`) is now unreachable,
-- since no such tag exists to join against. It is deliberately left in place —
-- it costs nothing, and it keeps the view correct on its own terms rather than
-- depending on this migration having run.
