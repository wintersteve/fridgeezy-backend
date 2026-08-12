-- Cuisine aliases: the spellings a model reaches for when it does not use ours.
--
-- `tag_aliases` held 43 dietary and 16 dish_form rows and ZERO cuisine rows,
-- which is backwards — cuisine is the one tag type `matchTags` auto-CREATES on a
-- miss, so an unrecognised spelling does not get dropped and logged, it becomes
-- a new row in the vocabulary. Every near-miss permanently widens the cuisine
-- tree and splits one cuisine's dishes across two tags. Two orphans
-- (`jewish`, `lithuanian`) are already in the live catalogue from that path.
--
-- This matters more now that cuisine is becoming part of dish identity: two
-- generations of one dish that disagree on the cuisine LABEL would otherwise be
-- two rows. Measured 2026-08-12, the adjudicator merges label drift reliably
-- (5/5) — but an alias collapses it for free, before any LLM is asked.
--
-- ## What belongs here, and what does not
--
-- An alias maps a spelling to an EXISTING tag, so it only helps for spellings
-- that are not themselves tags. It cannot merge two real tags: `persian` and
-- `iranian` are both seeded leaves for one country, and collapsing those needs a
-- data migration that re-points `recipe_tags`, not an alias.
--
-- Two shapes are included, and they trade differently:
--
-- 1. **Spelling variants** (`szechuan` -> `sichuan`, `lao` -> `laotian`). Pure
--    win, no information lost.
-- 2. **Regional -> national** (`tuscan` -> `italian`, `punjabi` -> `indian`).
--    Loses specificity, and is still right: there is no `tuscan` tag to preserve
--    it in, so the alternative is not a more specific tag, it is a runtime-
--    created orphan outside the filter tree. Note this is NOT applied where the
--    regional cuisine IS seeded — `sichuan`, `cantonese` and `hunan` are real
--    tags and keep their dishes, which is what the generator prompt asks for.
--
-- Deliberately excluded as ambiguous: `iberian` (spanish or portuguese),
-- `slavic`, `latin american`, `basque` and `catalan` (arguably distinct
-- cuisines, not spellings of `spanish`), `southwestern`, `new england`.
--
-- Mirrored in seeds/004_tag_aliases.sql so a `db reset` produces the same rows;
-- kept here as well because seeds only run on reset and existing databases would
-- never see them.

-- The SQL tag fallback in persist_recipe (and its three later revisions) has
-- always queried `tag_aliases.canonical_id`, and `matchTags` is about to as
-- well, but only `alias`, `tag_id` and `type` were indexed.
create index if not exists idx_tag_aliases_canonical_id
    on tag_aliases using btree (canonical_id);

insert into tag_aliases (tag_id, alias, type)
select t.id, a.alias, t.type
from tags t
         join (values
                   -- Chinese: regional spellings, and cities standing in for a
                   -- cuisine. The seeded regionals are kept, not collapsed.
                   ('sichuan', 'szechuan'),
                   ('sichuan', 'szechwan'),
                   ('sichuan', 'sichuanese'),
                   ('hunan', 'hunanese'),
                   ('shanghainese', 'shanghai'),
                   ('cantonese', 'hong kong'),
                   ('cantonese', 'guangdong'),
                   ('chinese', 'peking'),
                   ('chinese', 'beijing'),
                   -- Italian regionals — no seeded tag to preserve them in.
                   ('italian', 'tuscan'),
                   ('italian', 'sicilian'),
                   ('italian', 'neapolitan'),
                   ('italian', 'roman'),
                   ('italian', 'sardinian'),
                   -- French regionals, same reasoning.
                   ('french', 'provencal'),
                   ('french', 'provençal'),
                   ('french', 'alsatian'),
                   ('french', 'breton'),
                   ('french', 'burgundian'),
                   -- German-speaking regionals.
                   ('german', 'bavarian'),
                   ('german', 'swabian'),
                   ('austrian', 'viennese'),
                   -- Indian regionals. The model reaches for these constantly
                   -- and none of them is a seeded tag.
                   ('indian', 'punjabi'),
                   ('indian', 'bengali'),
                   ('indian', 'gujarati'),
                   ('indian', 'keralan'),
                   ('indian', 'goan'),
                   ('indian', 'hyderabadi'),
                   ('indian', 'south indian'),
                   ('indian', 'north indian'),
                   ('indian', 'desi'),
                   -- Mexican regionals.
                   ('mexican', 'oaxacan'),
                   ('mexican', 'yucatecan'),
                   -- Spelling variants and archaic names.
                   ('dutch', 'holland'),
                   ('turkish', 'anatolian'),
                   ('turkish', 'ottoman'),
                   ('laotian', 'lao'),
                   ('sri_lankan', 'ceylonese'),
                   ('burmese', 'burma'),
                   ('thai', 'siamese'),
                   ('taiwanese', 'taiwan'),
                   -- Umbrella terms that name a seeded REGION. Note the join is
                   -- on canonical_id, so these are underscored — see the repair
                   -- below for what happens when they are not.
                   ('north_african', 'maghrebi'),
                   ('north_african', 'maghreb'),
                   ('middle_eastern', 'arab'),
                   ('middle_eastern', 'arabic'),
                   ('scandinavian', 'nordic'),
                   ('southern', 'soul food'))
              as a(canon, alias) on a.canon = t.canonical_id
where t.type = 'cuisine'
on conflict do nothing;

-- Repair: four dish_form aliases that have never existed.
--
-- `20260803000009` joins its alias list on `a.canon = t.canonical_id` but passes
-- tag NAMES, so the two multi-word forms silently matched nothing: 'stir fry'
-- was compared against the canonical_id 'stir_fry', and 'rice dish' against
-- 'rice_dish'. The other 16 are single words where name and canonical_id
-- coincide, which is exactly why this went unnoticed — the statement succeeds
-- and inserts 16 of its 20 rows.
--
-- Fixed here rather than in that file: a migration that has already run against
-- the linked project would not re-run, and editing history to make a past
-- migration do something it did not do is the thing `20260801000003`'s header
-- warns against.
insert into tag_aliases (tag_id, alias, type)
select t.id, a.alias, t.type
from tags t
         join (values ('stir_fry', 'stir-fry'),
                      ('stir_fry', 'stirfry'),
                      ('rice_dish', 'fried rice'),
                      ('rice_dish', 'risotto'))
              as a(canon, alias) on a.canon = t.canonical_id
where t.type = 'dish_form'
on conflict do nothing;
