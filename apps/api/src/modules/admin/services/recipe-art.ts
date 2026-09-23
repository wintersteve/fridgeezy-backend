import { supabaseAdmin } from "@fridgeezy/supabase";

/**
 * Which dishes actually HAVE a picture, asked of storage rather than of a
 * column.
 *
 * ## Why `image IS NULL` is the wrong question
 *
 * `persistRecipeWithIngredientIds` stores the PREDICTED url — derived from the
 * dish's name — without waiting for the upload, which is deliberate and is what
 * lets persistence run while the render is still going. The consequence is that
 * `recipes.image` is non-null for essentially every row ever written, including
 * the ones whose upload never landed. So a filter on the column finds nothing,
 * always, and the count beside it reads 0 on a catalogue with missing art.
 *
 * That was not hypothetical: production reported `missingImage: 0` while Peking
 * Shredded Pork had no object in the bucket at all, which is exactly the dish a
 * curator opens this screen to find.
 *
 * ## One list call, not one per row
 *
 * `storage.list` returns the whole bucket in a page — 94 objects for 47 dishes,
 * hero plus card variant — so membership for the entire catalogue costs a single
 * request. A `download`-per-row existence check is the shape to avoid; it is
 * also what `create-recipe-image.ts` avoids, and for the same reason.
 *
 * `LIST_LIMIT` is the ceiling this stops being true at. Supabase caps a listing
 * at 1000 whatever is asked for, so beyond ~500 dishes this silently sees only
 * part of the bucket and would start reporting present art as missing. The
 * guard below says so out loud rather than letting the number quietly drift.
 */
const LIST_LIMIT = 1000;

const BUCKET = "recipes";

/**
 * The object key a stored image URL points at, or null.
 *
 * Taken from the URL rather than re-derived from the dish's name. They agree
 * today — the path IS `normalizeFileName(name)` — and they stop agreeing the
 * moment a dish is renamed, at which point re-deriving would report a picture
 * missing that is sitting right there under its old key. The URL is what the
 * reader's browser will actually fetch, so it is the honest thing to check.
 */
export const imageObjectKey = (image: string | null): string | null => {
    if (!image) return null;

    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const index = image.indexOf(marker);

    if (index === -1) return null;

    // A query string would not be part of the key. Nothing writes one today;
    // the console appends one to its own `<img>` and never to the column.
    return image.slice(index + marker.length).split("?")[0];
};

export interface RecipeArtIndex {
    /** Every object name in the bucket. */
    keys: Set<string>;
    /**
     * False when the listing could not be read, or hit {@link LIST_LIMIT}.
     *
     * Callers must treat an unusable index as "cannot tell" and report nothing,
     * rather than as "nothing is there" — which would mark the entire catalogue
     * as missing art on a storage hiccup.
     */
    usable: boolean;
}

export async function fetchRecipeArtIndex(): Promise<RecipeArtIndex> {
    const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .list("", { limit: LIST_LIMIT });

    if (error || !data) {
        console.error("[admin] could not list recipe art", error);
        return { keys: new Set(), usable: false };
    }

    if (data.length >= LIST_LIMIT) {
        console.error(
            `[admin] recipe art listing hit ${LIST_LIMIT} objects — paginate it before trusting this`
        );
        return { keys: new Set(data.map((object) => object.name)), usable: false };
    }

    return { keys: new Set(data.map((object) => object.name)), usable: true };
}

/** True when this row's picture is genuinely absent from the bucket. */
export const isArtMissing = (image: string | null, index: RecipeArtIndex): boolean => {
    if (!index.usable) return false;

    const key = imageObjectKey(image);

    // No URL at all, or one that does not name an object in this bucket — a
    // legacy host, a hand-edited value — is a dish with no picture either way.
    if (!key) return true;

    return !index.keys.has(key);
};
