import type { Page } from "@fridgeezy/admin-contract";
import type { Request, Response } from "express";
import { z, type ZodType } from "zod/v4";

/**
 * Parse a list request's query string, or answer 400 and return null.
 *
 * Every list route in this module opens with the same six lines otherwise. The
 * null-after-responding shape is `requireProfileId`'s, for the same reason: it
 * keeps the parse from growing an error branch at each of eight call sites.
 */
export function parseQuery<T>(
    schema: ZodType<T>,
    req: Request,
    res: Response
): T | null {
    const parsed = schema.safeParse(req.query);

    if (!parsed.success) {
        res.status(400).json({ error: z.prettifyError(parsed.error) });
        return null;
    }

    return parsed.data;
}

/** The same, for a JSON body. */
export function parseBody<T>(
    schema: ZodType<T>,
    req: Request,
    res: Response
): T | null {
    const parsed = schema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({ error: z.prettifyError(parsed.error) });
        return null;
    }

    return parsed.data;
}

/**
 * Wrap rows in the page envelope.
 *
 * `total` comes from PostgREST's `count: "exact"`, which rides on the same
 * request as the rows — so the console can say "50 of 412" without a second
 * round trip. It is nullable on the client type and never is in practice; a
 * null is reported as the page's own length rather than as zero, since a page
 * that plainly has rows must not claim it has none.
 */
export function toPage<T>(
    rows: T[],
    count: number | null,
    { limit, offset }: { limit: number; offset: number }
): Page<T> {
    return { rows, total: count ?? rows.length, limit, offset };
}

/**
 * The accent-folded form of a search term, for `ilike` against a `*_ascii`
 * column.
 *
 * Identical to `foldAccents` in the client and to `fold_accents()` in the
 * database — NFD, then strip the combining range. It is repeated here rather
 * than imported because `@fridgeezy/toolkit`'s canonicaliser singularises and
 * underscores as well, which is the wrong transform for a substring search.
 * A divergence raises nothing; it just makes dishes quietly unfindable, which
 * is why the rule is stated in all three places it lives.
 */
export function foldForSearch(term: string): string {
    return term
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase();
}

/**
 * Escape a term for a PostgREST `ilike` filter.
 *
 * `%` and `_` are wildcards and `,` `.` `(` `)` are how PostgREST separates
 * filter arguments — an unescaped one in a dish name turns a search into a
 * malformed filter, which comes back as a 400 the console can do nothing with.
 */
export function likeTerm(term: string): string {
    return `%${foldForSearch(term).replace(/[%_,.()]/g, " ")}%`;
}
