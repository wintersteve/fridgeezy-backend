/**
 * Pulls the drawn subject back so it occupies less of the frame.
 *
 * ## The prompt cannot do this, and that is measured three ways
 *
 * The framing line has always asked for the vessel to fill "about two thirds of
 * the frame's width", and `create-recipe-image` already recorded that moving it
 * between two thirds and three quarters changed nothing. Re-measured
 * 2026-09-19: with no style references at all it renders at 81-85%; rewritten
 * to demand HALF the frame with an explicit check, four rolls came back at
 * 89-92%; and shrinking every style anchor to 65% pulled it only to 78-81%.
 * The anchors move it about ten points and the words move it not at all — the
 * model draws food at roughly four fifths of the frame and means it.
 *
 * So this is arithmetic instead: shrink the picture, and give back the border
 * it lost as a flat band of the ground sampled from its own corner.
 *
 * ## Why a flat band, when the style block warns against exactly that
 *
 * `art-direction` says "a texture that stops inside the frame is a paper edge",
 * and it is right in general. Both alternatives were tried on the same
 * illustration and fail worse. A MIRROR is seamless by construction and useless
 * here: at 89% of the width the band being reflected contains the plate, which
 * comes back as ghost plates either side. REPLICATING edge columns outward is
 * the technique `create-recipe-image` records removing for its artefacts.
 *
 * What makes the flat band survive is its size and its colour: under an eighth
 * of the width, and sampled per image rather than assumed, so it is that
 * picture's own ground rather than a guess at the house cream. Eyeballed at
 * 0.65 and 0.72 before being written down. **The argument is about size — if a
 * caller ever needs a much wider band, look again rather than turning this up.**
 */

/**
 * Where the subject is asked to sit, as a fraction of the frame's width.
 *
 * Chosen off a rendered ladder — 89 (the model's own), 65, 58, 52, 45 — rather
 * than argued about. Two things bound it from below: the flat band grows as the
 * picture shrinks (73px at 65%, 148px here, 188px at 45%), and the whole case
 * for filling that band flat is that it stays small; and the subject sits at
 * 0.55 of the width rather than centred, which is barely visible at 65% and
 * plain by 45%.
 */
export const DEFAULT_SUBJECT_WIDTH = 0.65;

/**
 * Past this, the measurement is not describing a subject any more.
 *
 * A plate drawn as large as the model likes measures 89-90%; a picture with a
 * drawn border measures 96%, because the border IS the outermost ink. The two
 * need opposite treatment and only this number tells them apart.
 */
const EDGE_TO_EDGE = 0.93;

/**
 * How much of the frame's width the drawn subject spans.
 *
 * The threshold is deep on purpose: it finds the linework, not the soft cast
 * shadow, which spreads to one side and would report the subject as wider than
 * anybody sees it.
 */
async function subjectWidth(
    sharp: (typeof import("sharp"))["default"],
    source: Buffer,
): Promise<number> {
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

    return right > left ? (right - left) / info.width : 1;
}

/** The ground, from a corner the subject never reaches. */
async function groundColour(
    sharp: (typeof import("sharp"))["default"],
    source: Buffer,
) {
    const { data, info } = await sharp(source)
        .extract({ left: 4, top: 4, width: 60, height: 60 })
        .raw()
        .toBuffer({ resolveWithObject: true });

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) {
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
    }

    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
}

/**
 * Returns the picture with its subject at `target` of the frame's width.
 *
 * **It never throws and never grows a subject.** A picture already at or below
 * the target is returned untouched, and any failure returns the original — a
 * dish losing its margin is a worse outcome than a dish losing its picture is
 * an acceptable one, and this runs on the path that has just spent a model
 * call.
 */
export async function reframeSubject(
    source: Buffer,
    target: number = DEFAULT_SUBJECT_WIDTH,
): Promise<Buffer> {
    try {
        // Deferred for the reason `encodeRecipeImageVariants` states: a ~30 MB
        // native module a cold start must not pay for unless it encodes.
        const { default: sharp } = await import("sharp");

        const measured = await subjectWidth(sharp, source);
        if (measured <= target) return source;

        // Ink this close to the edge is not a big plate — it is something
        // touching the frame, and in practice that means a drawn border. The
        // trailer forbids one ("No ... borders or frames") and one still slips
        // through occasionally. Shrinking such a picture puts a flat band
        // OUTSIDE an edge that is already drawn, and the result reads as a
        // photograph of a photograph: measured at 96% on a French omelette, it
        // came back as a small plate inside a visible rectangle. Leave it.
        if (measured > EDGE_TO_EDGE) {
            console.warn(
                `[reframe-subject] subject spans ${(measured * 100).toFixed(0)}% — ` +
                    `something reaches the frame edge, probably a drawn border. Leaving it alone.`,
            );
            return source;
        }

        const meta = await sharp(source).metadata();
        if (!meta.width || !meta.height) return source;

        const background = await groundColour(sharp, source);
        const scale = target / measured;
        const width = Math.round(meta.width * scale);
        const height = Math.round(meta.height * scale);
        const dx = Math.round((meta.width - width) / 2);
        const dy = Math.round((meta.height - height) / 2);

        const body = await sharp(source).resize(width, height).toBuffer();

        return await sharp(body)
            .extend({
                top: dy,
                bottom: meta.height - height - dy,
                left: dx,
                right: meta.width - width - dx,
                background,
            })
            .png()
            .toBuffer();
    } catch (error) {
        console.error("[reframe-subject] leaving the picture as it is:", error);
        return source;
    }
}
