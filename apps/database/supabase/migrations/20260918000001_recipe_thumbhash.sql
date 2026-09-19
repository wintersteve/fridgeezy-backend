-- A ~30-byte ThumbHash of each dish's illustration, base64.
--
-- What it buys is the FIRST FRAME of the recipe page. The picture itself is a
-- 60-110 KB WebP in storage, and until it arrives the top 440pt of the screen is
-- a shimmering placeholder — on cellular that is most of a second on the app's
-- most-read screen.
--
-- The card-sized variant (`<name>_sm.webp`) already doubles as a progressive
-- preview, and it is better than this one when it applies: it is the real
-- picture. But it only applies when the reader arrived from a card that cached
-- it — `expo-image` will not display a placeholder that is itself still
-- loading, so a share link, a push notification or an unscrolled feed gets
-- nothing from it. This travels INSIDE the recipe row, so it is on screen in
-- the same frame as the title, before any image request exists.
--
-- Nullable, and null is the normal case for anything not yet backfilled — the
-- client simply falls back to the `_sm` preview and then the shimmer, which is
-- exactly what it did before this column. Written by
-- `encodeRecipeImageVariants` at generation time and by
-- `backfill-recipe-webp.ts` for the back catalogue.
--
-- Text rather than bytea: it is read on every recipe query and handed straight
-- to `expo-image` as a base64 string, so storing bytes would mean encoding it
-- again on every read.
alter table recipes
    add column if not exists thumbhash text;

comment on column recipes.thumbhash is
    'Base64 ThumbHash of the dish illustration, for an instant placeholder. Null until backfilled.';
