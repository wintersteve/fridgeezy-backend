-- Add a card-sized description to recipes.
--
-- `recipes.description` is a paragraph written for the detail screen, but recipe
-- cards clamp it to a single line — so every card ends mid-sentence. Suggestions
-- never had this problem: their description is generated short (and was being cut
-- to 50 characters), which is what a card actually wants.
--
-- `short_description` is that card line for real recipes: one complete sentence,
-- written by the model at generation time alongside the long description. It is
-- nullable, and every read path falls back to `description`, so recipes generated
-- before this column existed keep rendering exactly as they do today.
alter table recipes
add column short_description text;

comment on column recipes.short_description is 'One-sentence card description. Falls back to `description` when null (recipes generated before 2026-07-30).';
