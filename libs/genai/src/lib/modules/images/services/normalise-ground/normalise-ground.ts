/**
 * Force a technique illustration's ground to the exact colour it was asked for,
 * and encode it for storage.
 *
 * ## Why this exists
 *
 * The prompt asks for `#FFFFFF` and the model never returns it. Measured across
 * eleven renders on 2026-09-17/18 the corners came back anywhere from `#FAFAFA`
 * to `#FDFAF3` — neutral on one render and eight units warm on the next, for
 * the same prompt. That drift is documented on `generate-image.ts` as the axis
 * to watch on any model swap, and it is not a bug in the request; it is what
 * image models do with a background instruction.
 *
 * It matters here more than it does for the food illustrations, and for a
 * reason specific to this surface: a technique plate is drawn inside a framed
 * box on a UI surface, so the client has to paint a backdrop colour BEHIND it
 * for the sliver the corner radius leaves. That backdrop can only be one hex.
 * Against a set whose grounds differ by eight units, any single value is wrong
 * for most of them — which is why the token was a sampled MEAN with its spread
 * written down rather than a colour anybody chose.
 *
 * Normalising removes the problem instead of averaging it: the ground becomes
 * the value that was asked for, so the token is simply that value.
 *
 * ## How, and why it is not a plain gain
 *
 * A per-channel curve with a KNEE. Below the knee nothing moves at all; between
 * the knee and the measured ground, values are stretched so the ground lands
 * exactly on the target. Each channel gets its own curve, which corrects the
 * colour CAST at the same time — a ground eight units warm has its blue
 * stretched further than its red, the correction a photographer's white balance
 * makes.
 *
 * **The obvious version — a flat gain, `out = in * (target / ground)` — was
 * built first and measured, and it damages the pictures.** Scaling everything
 * by 1.02 to lift a 250 ground to 255 also lifts every highlight in the
 * subject, and these are watercolours full of white ceramic, steam and pale
 * dough sitting just below the ground in value. Measured over the seven bundled
 * plates on 2026-09-18: **6% to 20% of the SUBJECT area blew out to pure
 * white**, against 0% before. That is the bowls and the steam losing their
 * modelling to fix a background number, which is the correction doing more harm
 * than the drift it was aimed at.
 *
 * The knee is what separates the two. Everything more than {@link KNEE_WIDTH}
 * units below the ground — which is the whole subject — is passed through
 * untouched, byte for byte.
 *
 * ## What it still costs, stated rather than discovered later
 *
 * The ground is not flat. The art direction spends a whole sentence on the
 * paper tooth continuing unbroken beneath the picture, and that tooth is real
 * variance of a few units. **A ground whose typical pixel IS `#FFFFFF` cannot
 * also carry variance above it** — that is arithmetic, not tuning — so mapping
 * the ground's median to 255 necessarily flattens the lighter half of the tooth
 * in the empty margin. The knee confines that loss to the margin; it does not
 * abolish it.
 *
 * {@link NormaliseGroundOptions.target} is the dial. 255 gives corners that
 * sample exactly `#FFFFFF` and a flatter margin; 252 keeps the tooth almost
 * intact and lands fractionally short.
 *
 * ## Verified, not assumed
 *
 * The knee's guarantee is checked rather than believed: over the seven bundled
 * plates, **zero pixels below the knee changed by a single level** when the
 * curve was applied without re-encoding. Every difference that showed up in an
 * earlier measurement was the JPEG round trip, which is why `quality` is what
 * it is.
 */
export interface NormaliseGroundOptions {
    /**
     * What the ground should become, per channel. 255 is exact white and clips
     * the lighter half of the paper tooth; 252-253 keeps the tooth and lands
     * fractionally short.
     */
    target?: number;
    /**
     * The most any channel may be scaled. A guard, not a tuning knob: it only
     * bites if the border ring is not actually ground — a full-bleed painting,
     * or a subject cropped to the edge — and without it such an image would be
     * blown out rather than left alone.
     */
    maxGain?: number;
    /**
     * WebP quality for the re-encode.
     *
     * **WebP at 82, the encoding `create-recipe-image` already measured for
     * exactly this kind of picture**: flat watercolour on a plain ground, which
     * is the one thing PNG is worst at and JPEG is only middling at — 1522 KB
     * as PNG against 58 KB as WebP q82 at the same pixel dimensions.
     *
     * It also happens to solve a problem the JPEG version had. Correcting the
     * ground means decoding, changing pixels and encoding again, and that round
     * trip cost more than the correction did: re-encoding to JPEG q82 moved
     * roughly 540,000 pixels per plate, the worst by 30 levels, against ZERO
     * moved by the curve itself below the knee. JPEG q95 brought that down at
     * the cost of a much larger file. WebP q82 gets both — smaller than the
     * JPEG q82 and closer to the source than the JPEG q95.
     */
    quality?: number;
}

/** The fraction of each edge sampled as "ground". */
const BORDER_FRACTION = 0.02;

/**
 * How far below the measured ground the correction reaches.
 *
 * Everything darker than this is passed through untouched, which is what keeps
 * the subject out of it. Twelve units is comfortably wider than the paper
 * tooth's own variance (a few units) and comfortably narrower than the gap
 * between the ground and the brightest thing actually drawn — measured across
 * the bundled set, a white ceramic bowl's highlights sit well below it.
 */
const KNEE_WIDTH = 12;

const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The ground colour, per channel, from the border ring.
 *
 * The MEDIAN rather than the mean, and that is the whole robustness story: a
 * subject that touches an edge — a pan handle running off the frame, a board
 * cropped by the bottom — drags a mean toward the subject and leaves the
 * correction wrong for the other 98% of the ground. A median ignores it as long
 * as the ring is mostly ground, which it is by construction, because the
 * framing rule asks for a generous even margin on all four sides.
 */
const measureGround = (
    data: Buffer,
    width: number,
    height: number,
    channels: number,
): [number, number, number] => {
    const band = Math.max(1, Math.round(Math.min(width, height) * BORDER_FRACTION));
    const samples: [number[], number[], number[]] = [[], [], []];

    const push = (x: number, y: number) => {
        const i = (y * width + x) * channels;

        samples[0].push(data[i]);
        samples[1].push(data[i + 1]);
        samples[2].push(data[i + 2]);
    };

    for (let y = 0; y < height; y++) {
        const onHorizontalBand = y < band || y >= height - band;

        for (let x = 0; x < width; x++) {
            if (onHorizontalBand || x < band || x >= width - band) push(x, y);
        }
    }

    return [median(samples[0]), median(samples[1]), median(samples[2])];
};

export interface NormaliseGroundResult {
    image: Buffer;
    /** What the ground measured before the correction, as `#RRGGBB`. */
    before: string;
    /** The per-channel gains applied. */
    gains: [number, number, number];
}

const hex = (rgb: number[]): string =>
    "#" +
    rgb
        .map((v) => Math.round(v).toString(16).padStart(2, "0").toUpperCase())
        .join("");

export async function normaliseGround(
    input: Buffer,
    options: NormaliseGroundOptions = {},
): Promise<NormaliseGroundResult> {
    const { target = 255, maxGain = 1.12, quality = 82 } = options;

    // Imported here rather than at the top of the file, and it is not a style
    // choice — `create-recipe-image` records the same three reasons for the
    // same import. `sharp` is a ~30 MB native module and loading libvips is not
    // free; only this path needs it, and this library is imported at the TOP
    // LEVEL by the API, so a static import here would make every cold Lambda
    // start pay for it before serving a chat turn that never touches an image.
    // It also keeps the deployment artifact's module-graph check from needing a
    // macOS binary the artifact must not contain.
    const { default: sharp } = await import("sharp");

    const { data, info } = await sharp(input)
        .raw()
        .toBuffer({ resolveWithObject: true });

    const ground = measureGround(data, info.width, info.height, info.channels);

    const gains = ground.map((value) =>
        // A ground already at or above the target is left alone rather than
        // pulled DOWN — darkening a picture to hit a background number would be
        // the correction doing more harm than the drift it is fixing.
        Math.min(maxGain, Math.max(1, target / Math.max(value, 1))),
    ) as [number, number, number];

    // One 256-entry lookup per channel, applied in raw pixel space. sharp's own
    // `linear` is affine and therefore cannot express a knee.
    const luts = ground.map((value, channel) => {
        const lut = new Uint8Array(256);
        const ceiling = Math.min(255, value * gains[channel]);
        const knee = Math.max(0, value - KNEE_WIDTH);
        const span = Math.max(1, value - knee);

        for (let v = 0; v < 256; v++) {
            lut[v] =
                v <= knee
                    ? v
                    : Math.min(
                          255,
                          Math.round(knee + ((v - knee) * (ceiling - knee)) / span),
                      );
        }

        return lut;
    });

    const corrected = Buffer.from(data);

    for (let i = 0; i < corrected.length; i += info.channels) {
        corrected[i] = luts[0][corrected[i]];
        corrected[i + 1] = luts[1][corrected[i + 1]];
        corrected[i + 2] = luts[2][corrected[i + 2]];
    }

    const image = await sharp(corrected, {
        raw: { width: info.width, height: info.height, channels: info.channels },
    })
        .webp({ quality })
        .toBuffer();

    return { image, before: hex(ground), gains };
}
