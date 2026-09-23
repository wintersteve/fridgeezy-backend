/** The console's opening screen: what is in the catalogue and what is wrong with it. */
export interface AdminOverview {
    recipes: {
        total: number;
        /** Excludes variants — `base_recipe_id is null` — so this is dishes. */
        dishes: number;
        hidden: number;
        missingImage: number;
        /**
         * Recipes whose `image` points at a host the public cannot reach — a
         * developer's LAN address or loopback, copied in from a local stack.
         *
         * Counted separately from `missingImage` because the two look identical
         * to a reader (no picture) and are opposite jobs: one needs a
         * generation, this needs a URL rewritten and the bytes are already in
         * the bucket. Always 0 against a local stack, where a private host is
         * the correct value.
         */
        unreachableImage: number;
        imported: number;
    };
    suggestions: {
        total: number;
        hidden: number;
        /** Never promoted: the pool the feed is still drawing ideas from. */
        unpromoted: number;
    };
    ingredients: {
        total: number;
        missingShelfLife: number;
        unclassifiedComponent: number;
    };
    users: {
        total: number;
        admins: number;
        subscribers: number;
        /** Signed up in the last 30 days. */
        recent: number;
    };
    /** AI calls in the last 7 days, by bucket. */
    usage: Record<string, number>;
}
