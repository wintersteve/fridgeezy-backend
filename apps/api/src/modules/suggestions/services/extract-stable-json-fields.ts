/**
 * Incrementally extract the top-level fields of a single JSON object that are
 * already COMPLETE within a (possibly truncated) buffer.
 *
 * A field is "stable" once its value has been fully parsed — a closed string,
 * a balanced array/object, or a keyword/number followed by more input. Fields
 * whose value is still mid-token are omitted, and once one field is incomplete
 * we stop (later fields can't be trusted yet). This lets a caller reveal each
 * field the instant it finishes streaming from an LLM token stream.
 *
 * Only the first JSON object in the buffer is considered.
 */
export function extractStableJsonFields(
    buffer: string
): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const start = buffer.indexOf("{");
    if (start === -1) return result;

    let i = start + 1;

    const skipWs = () => {
        while (i < buffer.length && /\s/.test(buffer[i])) i++;
    };

    while (i < buffer.length) {
        skipWs();
        if (i >= buffer.length) break;

        const ch = buffer[i];
        if (ch === "}") break; // object closed
        if (ch === ",") {
            i++;
            continue;
        }
        if (ch !== '"') break; // expected the start of a key

        const keyEnd = scanString(buffer, i);
        if (keyEnd === -1) break; // key still streaming
        const key = JSON.parse(buffer.slice(i, keyEnd)) as string;
        i = keyEnd;

        skipWs();
        if (i >= buffer.length || buffer[i] !== ":") break; // colon not here yet
        i++;
        skipWs();

        const valueStart = i;
        const valueEnd = scanValue(buffer, i);
        if (valueEnd === -1) break; // value still streaming — stop here

        try {
            result[key] = JSON.parse(buffer.slice(valueStart, valueEnd));
        } catch {
            break; // defensive: a scanned value should always parse
        }
        i = valueEnd;
    }

    return result;
}

/** End index (exclusive) of the string starting at `i`, or -1 if unterminated. */
function scanString(s: string, i: number): number {
    if (s[i] !== '"') return -1;
    i++;
    while (i < s.length) {
        const c = s[i];
        if (c === "\\") {
            i += 2; // skip the escaped character
            continue;
        }
        if (c === '"') return i + 1;
        i++;
    }
    return -1;
}

/** End index (exclusive) of a complete JSON value at `i`, or -1 if incomplete. */
function scanValue(s: string, i: number): number {
    if (i >= s.length) return -1;
    const c = s[i];
    if (c === '"') return scanString(s, i);
    if (c === "{" || c === "[") return scanContainer(s, i);
    if (c === "t") return scanLiteral(s, i, "true");
    if (c === "f") return scanLiteral(s, i, "false");
    if (c === "n") return scanLiteral(s, i, "null");
    return scanNumber(s, i);
}

/** Match a balanced array/object (honouring strings), or -1 if not yet closed. */
function scanContainer(s: string, i: number): number {
    const stack: string[] = [];
    let inStr = false;

    for (; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (c === "\\") {
                i++; // skip the escaped character
                continue;
            }
            if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') {
            inStr = true;
            continue;
        }
        if (c === "{" || c === "[") {
            stack.push(c);
        } else if (c === "}" || c === "]") {
            stack.pop();
            if (stack.length === 0) return i + 1;
        }
    }
    return -1;
}

/** Match a literal (true/false/null), or -1 if absent/still streaming. */
function scanLiteral(s: string, i: number, literal: string): number {
    if (s.slice(i, i + literal.length) === literal) return i + literal.length;
    return -1;
}

/**
 * Match a number, or -1 if incomplete. A number is only complete once a
 * following delimiter proves it isn't still growing (e.g. "1" then "2" → "12").
 */
function scanNumber(s: string, i: number): number {
    const start = i;
    while (i < s.length && /[-+0-9.eE]/.test(s[i])) i++;
    if (i === start) return -1; // not a number
    if (i >= s.length) return -1; // could still be growing
    return i;
}
