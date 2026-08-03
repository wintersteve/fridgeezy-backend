/**
 * Pull every top-level `{...}` out of a string by matching braces, ignoring line
 * breaks entirely.
 *
 * For reading JSONL back from a model. Prompts ask for one object per line and
 * mostly get it, but not reliably: over a 533-item classification run the model
 * four times ran several objects together on one line and once emitted a stray
 * extra `}`. Splitting on "\n" and parsing each line meant ONE such line
 * discarded every object on it — 28 records lost to 4 bad lines. Matching braces
 * costs a malformed object only itself.
 *
 * Returns the raw substrings, not parsed values: the caller knows the expected
 * shape and what to do with one that does not fit.
 */
export function extractJsonObjects(text: string): string[] {
    const objects: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // Braces inside a string literal are data, not structure.
        if (inString) {
            // A raw newline cannot occur inside a valid JSON string — it has to
            // be escaped as \n — so reaching one means the quote was never
            // closed and this object is already lost. Abandon it here rather
            // than staying "inside the string" and consuming the objects that
            // follow: one unterminated quote should cost one record, not the
            // rest of the response.
            if (char === "\n") {
                depth = 0;
                start = -1;
                inString = false;
                escaped = false;
                continue;
            }

            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === '"') inString = false;
            continue;
        }

        if (char === '"') inString = true;
        else if (char === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (char === "}") {
            if (depth > 0) {
                depth--;
                if (depth === 0 && start >= 0) {
                    objects.push(text.slice(start, i + 1));
                    start = -1;
                }
            }
            // depth === 0 here is a stray closer; skip it rather than going
            // negative and swallowing the next real object.
        }
    }

    return objects;
}
