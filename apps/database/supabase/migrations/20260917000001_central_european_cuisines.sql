------------------------------------------------------------------------------
-- Central European gets its cuisines
--
-- `003_cuisine_tags.sql` creates `central european` and parents it to
-- `european`, and then never assigns a single leaf to it — the only one of the
-- 26 middle-level cuisine tags with no `LEVEL 3 -> LEVEL 2` block. Measured
-- against a seeded database: zero children, and zero rows in `recipe_tags`.
--
-- The client is not wrong about it, which is why this is a data fix and not an
-- app one. `buildCuisineSections` sends a childless middle tag to `direct` and
-- draws it as a CUISINE rather than as a region — "a region with no cuisines
-- inside it is not a grouping, it is a cuisine that happens to sit one level
-- up" — so `/cuisines` renders a "Central European" chip under Europe whose tap
-- opens a cuisine-filtered search that can only ever come back empty. Since
-- `20260803000002` a region returns its whole subtree, and this one has none.
--
-- **The fix is to fill it rather than to delete it**, and the argument is the
-- coherence of what is left behind. `eastern european` is presently three
-- kitchens in one bucket: the Central European cluster below, the East Slavic
-- one (russian / ukrainian / belarusian), and bulgarian + romanian, which lean
-- Balkan. The whole reason the hierarchy is shown at all is that a region
-- actually returns every dish beneath it, so a region whose dishes have nothing
-- to do with each other is the failure that containment was meant to buy its
-- way out of. `western european` has the milder version of the same problem,
-- holding austrian next to french and dutch.
--
-- **It is free TODAY and will not be.** Nothing moves: every one of the five
-- leaves below has zero recipes on it, so no row changes hands, no reader's
-- persisted cuisine filter narrows, and no `find_recipes` result shifts. The
-- moment the catalogue holds a goulash or a pierogi that stops being true — so
-- the window for making this cost nothing is open now and closes on its own.
--
-- **Five leaves, and the contested ones are deliberately left alone.** austrian,
-- czech, slovak, hungarian and polish are Central European under essentially
-- every classification. `german` and `swiss` genuinely straddle (northern
-- Germany reads Dutch/Danish, the south reads Bavarian) and `slovenian` reads
-- Austro-Hungarian as easily as Balkan; each is an argument someone would
-- reopen, and an arguable move is worth less than an unarguable one. Likewise
-- bulgarian and romanian sitting in `eastern european` rather than `balkan` is
-- arguable and is not what was broken here.
--
-- Nothing on the client needs a deploy. `useTags` is the hourly REFERENCE tier
-- with `refetchOnMount: true`, so an installed app picks the new shape up on
-- its own; the tag NAMES are untouched, so the embeddings `embed-tags` wrote
-- stay correct and need no re-run.
--
-- `003_cuisine_tags.sql` gains the matching block, so a fresh seed and a
-- migrated database agree.
------------------------------------------------------------------------------

do
$$
    declare
        v_parent uuid;
        v_moved  integer;
    begin
        select id into v_parent from tags where name = 'central european' and type = 'cuisine';

        -- A fresh database applies MIGRATIONS BEFORE SEEDS, so on `db reset` this
        -- tag does not exist yet and there is nothing here to move —
        -- `003_cuisine_tags.sql` already produces the shape below on its own.
        -- Only an already-seeded database has work to do, which is why this
        -- returns rather than asserting: the assertion below would otherwise
        -- fail every reset, and a migration that cannot be replayed from nothing
        -- is a migration that quietly stops being the source of truth.
        if v_parent is null then
            raise notice 'central european cuisine tag not seeded yet; 003_cuisine_tags.sql will parent these';
            return;
        end if;

        update tags
        set parent_id = v_parent
        where name in ('austrian', 'czech', 'slovak', 'hungarian', 'polish')
          and type = 'cuisine';

        -- A silent no-op is the failure mode worth guarding: the update matches
        -- on NAME, so a renamed tag moves nothing and reports success.
        select count(*)
        into v_moved
        from tags
        where type = 'cuisine'
          and parent_id = v_parent;

        if v_moved <> 5 then
            raise exception 'expected 5 central european cuisines, found %', v_moved;
        end if;
    end
$$;
