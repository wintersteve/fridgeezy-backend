/**
 * Chooses between several renders of one dish by how they are FRAMED.
 *
 * ## Why a chooser and not a better prompt
 *
 * Because framing is the one property nothing else could pin. Measured across
 * today: rewording the framing line moved the subject's size not at all,
 * generating with no references at all gave the same size, and the style
 * anchors moved it about ten points and no further. What they cannot do at all
 * is make one render match the next — the same dish comes back at one camera
 * and then another, and every picture rejected tonight was that variance
 * rather than a rule being broken.
 *
 * So the model is asked twice and the better answer is kept. That is the same
 * move that made subject size deterministic, pointed at the thing that is still
 * a dice roll.
 *
 * ## The target is measured, not chosen
 *
 * Taken from the pictures the owner named as right — Tuna Tataki, Spicy Miso
 * Ramen, Greek Salad, Pizza Margherita — which agree to three decimal places:
 *
 *   size 89-90% of the frame's width · centre at 0.55 · subject running off the
 *   RIGHT edge at 0.998
 *
 * And from the two he called wrong, which differ in exactly those terms: the
 * Japanese Cheesecake at 87% / 0.514 / 0.948, and Chicken Kiev at 79% / 0.490 /
 * 0.884. Both sit politely inside the frame; the house look does not. **Being
 * clipped by the right edge is the signature**, not a defect to correct — which
 * is why `reframeSubject`, which centres and shrinks, made every picture worse.
 */

/** What the pictures judged right agree on. */
const TARGET_CENTRE = 0.55;
const TARGET_SIZE = 0.89;
/** Past this the subject is touching the right edge, which is the look. */
const REACHES_EDGE = 0.985;

export interface Framing {
    /** Subject width as a fraction of the frame. */
    size: number;
    /** Midpoint of the subject, as a fraction of the frame's width. */
    centre: number;
    /** Where the subject's right edge falls. 1.0 means it is clipped. */
    right: number;
    /** Lower is closer to the house framing. */
    score: number;
}

/**
 * Measures one render.
 *
 * The threshold is deep on purpose: it finds the drawn subject, not the soft
 * cast shadow, which spreads to one side and would report every picture as
 * wider and further right than it looks.
 */
export async function measureFraming(source: Buffer): Promise<Framing | null> {
    try {
        // Deferred as everywhere else here: a ~30 MB native module a cold start
        // must not pay for unless it is actually looking at pixels.
        const { default: sharp } = await import("sharp");

        const { data, info } = await sharp(source)
            .resize({ width: 500 })
            .greyscale()
            .raw()
            .toBuffer({ resolveWithObject: true });

        const sorted = Uint8Array.from(data).slice().sort();
        const ground = sorted[Math.floor(sorted.length * 0.9)];

        let left = info.width;
        let right = 0;
        for (let y = 0; y < info.height; y++) {
            for (let x = 0; x < info.width; x++) {
                if (data[y * info.width + x] < ground - 45) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                }
            }
        }

        if (right <= left) return null;

        const size = (right - left) / info.width;
        const centre = (left + right) / 2 / info.width;
        const rightEdge = right / info.width;

        // Weighted so the edge dominates: a picture that stops short of the
        // right edge is the failure that was actually complained about, where a
        // couple of points of size is not.
        const score =
            Math.max(0, REACHES_EDGE - rightEdge) * 4 +
            Math.abs(centre - TARGET_CENTRE) * 2 +
            Math.max(0, TARGET_SIZE - size);

        return { size, centre, right: rightEdge, score };
    } catch (error) {
        console.error("[pick-framing] could not measure a render:", error);
        return null;
    }
}

/**
 * The best-framed of several renders of the same dish.
 *
 * **Never empty-handed**: a candidate that cannot be measured still counts, and
 * if none can be measured the first one is returned. This sits on the path that
 * has already paid for the images, and a dish with an oddly framed picture
 * beats a dish with none.
 */
export async function pickBestFraming(
    candidates: Buffer[],
): Promise<{ chosen: Buffer; framings: (Framing | null)[] }> {
    const framings = await Promise.all(candidates.map(measureFraming));

    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    framings.forEach((framing, index) => {
        if (framing && framing.score < bestScore) {
            bestScore = framing.score;
            bestIndex = index;
        }
    });

    return { chosen: candidates[bestIndex], framings };
}
