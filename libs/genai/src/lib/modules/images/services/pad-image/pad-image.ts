import { deflateSync, inflateSync } from "node:zlib";

/**
 * Widens a portrait PNG to a square by extending its own background outward.
 *
 * ## Why this exists
 *
 * The client renders one generated illustration into three very differently
 * shaped boxes, all with `cover`, which centre-crops:
 *
 * | surface           | box            | aspect |
 * | ----------------- | -------------- | ------ |
 * | recipe detail hero| full width x460 | ~0.85 |
 * | recipe card hero  | 272 x 200      | 1.36   |
 * | card thumb        | 25% column     | ~0.62  |
 *
 * A 3:4 (0.75) render dropped into the 1.36 card hero keeps only the central
 * **55% of its height** — which cropped straight through the plate on every
 * dish measured (3–8% of the plate lost, 0/6 surviving all three surfaces).
 *
 * Two fixes were tried and rejected before this one:
 *
 * - **`contentFit="contain"` in the client.** Correct about the crop, wrong
 *   about the result: it letterboxes a hero that has to be full-bleed.
 * - **Asking the model for a smaller plate.** Measured across three phrasings:
 *   the best more than halved the clipping, but plate size still swung from 51%
 *   to 87% of frame height across dishes with an identical prompt. Plate size
 *   is not reliably promptable, so no wording makes this a guarantee.
 *
 * Padding is the deterministic one. It shrinks the plate *relative to the frame*
 * without touching the artwork, so a 3:4 render at ~76% frame width becomes
 * ~56% of a square — inside the safe area of all three crops at once. The
 * padding is baked into the stored asset, so the image is still full-bleed
 * everywhere it is displayed; nothing in the client changes.
 *
 * Measured over nine renders: 8 survive all three crops, against 0 before.
 * The one failure is a render where the model ignored the framing outright and
 * drew a bowl at 88% of frame width. Padding wider would not save it: the
 * thumb's constraint works out to `plateWidthPx <= 0.62 * sourceHeight`, which
 * has no `W` in it — horizontal padding cannot affect that crop at all, and a
 * fix would mean padding vertically too, shrinking every well-behaved image to
 * rescue a rare bad one. Square is the balance point; going wider costs the
 * plate real presence on the detail hero for a case this uncommon.
 *
 * ## Why it replicates the edge instead of filling with a colour
 *
 * Two flat-fill approaches were tried and both left a visible seam:
 *
 * - **The palette token.** The art direction asks for a #FDFBF9 ground and the
 *   model does not deliver one — measured output is nearer #F6F0E0. Two
 *   different creams meet in a straight line.
 * - **A colour sampled from the image.** Closer, but still seamed: the style
 *   block lights the scene from the upper left, so the background carries a
 *   gradient. One colour cannot match a gradient, and the mismatch showed up
 *   plainly in the top-left corner.
 *
 * Each padding pixel therefore copies the nearest edge pixel *on its own row*,
 * which continues whatever gradient, grain and vignette that row already has.
 * The seam disappears because there is nothing new being introduced.
 *
 * ## Why a row is not allowed to be much darker than its neighbours
 *
 * Copying one pixel across 160 columns is faithful to the row and brutal to a
 * *localised* mark that happens to sit on the edge, because it stretches that
 * mark's darkest value into a flat bar with a hard horizontal edge — the one
 * shape that never occurs in the artwork and so reads instantly as damage.
 *
 * The renders have exactly such a mark. Measured over 26 stored recipe images
 * (2026-08-20), a 24x24 patch at the **top-left** corner is 12-44 levels darker
 * than the other three, which agree with each other to within about one level
 * on every image. It is a soft corner shadow roughly 35 rows tall on the edge
 * column itself; the art direction fights it in two places already (the medium
 * clamp's "no edge, corner or shadow of its own" and the Light rule's ban on
 * shadows from objects outside the frame) and has not eliminated it. Unpadded
 * it reads as a slightly grubby corner. Padded it became a black bar.
 *
 * So each padded row is clamped: it may be no more than `EDGE_SHADOW_TOLERANCE`
 * darker than the **median** of the edge column within
 * `EDGE_NEIGHBOURHOOD_RADIUS` rows of it. A median rather than a mean because a
 * 35-row dark run inside a 301-row window does not move it at all, while a
 * genuine top-to-bottom gradient passes through untouched — the median of a
 * ramp is its own centre value.
 *
 * Three properties make this safe to leave on:
 *
 * - **It only ever lightens.** The correction is one-sided, so nothing that
 *   already agrees with its neighbours can be made worse.
 * - **It is continuous.** A row at exactly the tolerance gets a gain of 1, so
 *   there is no step between corrected and uncorrected rows. The tolerance sits
 *   well above the edge column's own noise (measured at about +/-2%), which is
 *   what stops this rectifying grain into a uniformly brighter pad — the seam
 *   the whole strategy exists to avoid.
 * - **It touches the padding only.** Pixels inside the original frame are
 *   copied byte for byte, exactly as before. This is a padding routine, not a
 *   retoucher; the corner shadow inside the frame is the prompt's problem.
 *
 * The gain is applied to all three channels alike so it lifts value without
 * moving hue.
 *
 * ## Scope
 *
 * Handles the 8-bit non-interlaced RGB/RGBA PNGs the image models return. Any
 * other encoding, or an already-landscape image, is passed through untouched —
 * this is a best-effort improvement to an image that is already fine to ship,
 * never a reason to fail a recipe.
 */
export function padPngToSquare(png: Buffer): Buffer {
    try {
        const image = decodePng(png);
        if (!image || image.width >= image.height) return png;
        return encodeRgbPng(padded(flattenTopLeftShadow(image)));
    } catch {
        // A recipe with a slightly mis-cropped image beats a recipe with none.
        return png;
    }
}

interface DecodedPng {
    width: number;
    height: number;
    /** Bytes per pixel in `pixels` — 3 (RGB) or 4 (RGBA). */
    channels: number;
    pixels: Buffer;
}

function decodePng(png: Buffer): DecodedPng | null {
    if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) return null;

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    const idat: Buffer[] = [];

    while (offset + 8 <= png.length) {
        const length = png.readUInt32BE(offset);
        const type = png.toString("ascii", offset + 4, offset + 8);
        const data = png.subarray(offset + 8, offset + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            interlace = data[12];
        } else if (type === "IDAT") {
            idat.push(data);
        } else if (type === "IEND") {
            break;
        }
        offset += 12 + length;
    }

    // 8-bit truecolour only. Palette and 16-bit would need their own unpacking
    // and the image models do not emit them.
    if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6))
        return null;

    const channels = colorType === 6 ? 4 : 3;
    const raw = inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    const pixels = Buffer.alloc(height * stride);

    let read = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[read++];
        const line = raw.subarray(read, read + stride);
        read += stride;
        const row = pixels.subarray(y * stride, (y + 1) * stride);
        const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? row[i - channels] : 0;
            const up = prior ? prior[i] : 0;
            const upLeft = prior && i >= channels ? prior[i - channels] : 0;
            let value = line[i];
            if (filter === 1) value += left;
            else if (filter === 2) value += up;
            else if (filter === 3) value += (left + up) >> 1;
            else if (filter === 4) {
                const p = left + up - upLeft;
                const dL = Math.abs(p - left);
                const dU = Math.abs(p - up);
                const dUL = Math.abs(p - upLeft);
                value += dL <= dU && dL <= dUL ? left : dU <= dUL ? up : upLeft;
            }
            row[i] = value & 0xff;
        }
    }

    return { width, height, channels, pixels };
}

/** RGB rows, each prefixed with filter byte 0, ready for deflate. */
interface RgbRaster {
    width: number;
    height: number;
    rows: Buffer;
}

/**
 * Lifts the soft dark mass the image models bank into the top-left corner of
 * the frame.
 *
 * ## Why this is here and not in the prompt
 *
 * It is the model's, not the art direction's. Strip the prompt to "a completely
 * flat, featureless, evenly lit pale cream background — no object, no texture,
 * no shading, no vignette", with no style block, no light source and no
 * subject, and it still arrives: two of four such renders came back with a
 * top-left corner 25 and 19 levels darker than the other three (2026-08-20).
 * Nothing in that sentence can produce a corner shadow.
 *
 * It is also systematic rather than noise. Over 48 renders at 864x1184 the
 * top-left corner was 5+ levels darker than the mean of the other three in 88%
 * of them and 20+ levels darker in a third, and the **best** case across all 48
 * was +1.2 — it is essentially never lighter, which random texture would be
 * half the time.
 *
 * Two rounds of prompt wording were tried and neither survives scrutiny. Naming
 * the corner made it *worse* on all three dishes it was tried on (by 8-18
 * levels) — a location you negate is a location you plant. A generic "the
 * ground holds one even value" clause scored better on n=4, but that sample sat
 * inside a per-render spread of +1 to -44 and did not replicate. **Do not spend
 * another round on prompt wording**; this is where it gets fixed.
 *
 * ## What it does
 *
 * Measured on three badly-affected renders, the artifact is a soft mass peaking
 * at 43-61 levels in the very corner and decaying to the background's own noise
 * (about +/-7) by x~100 and y~130 — roughly the top-left 12% x 11% of frame. So
 * the correction is a smooth field over a window of `CORNER_WINDOW_FRACTION`,
 * *added* to the pixels rather than flattening them: the empty ground carries
 * the medium's tooth, and a routine that levelled it would leave a suspiciously
 * clean patch where the shadow used to be. Adding a low-frequency field lifts
 * the value and leaves every mark in place.
 *
 * Five properties keep it from touching artwork, which matters because the
 * plate's own left edge sits at x~85 at mid-height — closer to the corner than
 * the window is wide, and only the window's *height* keeps them apart:
 *
 * - **Corner-anchored by construction.** The coarse field is forced monotonically
 *   non-increasing rightward and downward from the corner, so any bump that does
 *   not originate at (0,0) — which is what an object in the window looks like —
 *   is clipped away by its own neighbours rather than amplified.
 * - **Robust cells.** Each cell's deficit is a median against the same row, so
 *   linework and grain do not drag it.
 * - **It only acts on an asymmetry.** If the other three corners are as dark as
 *   this one, nothing happens — see the gate below.
 * - **It bails out.** A window holding more than `CORNER_ARTWORK_FRACTION` of
 *   pixels darker than `CORNER_ARTWORK_DEFICIT` is a window with something real
 *   in it; the image is returned untouched. A soft shadow never gets that dark.
 * - **It only ever lightens**, and tapers to zero before the window's edge, so
 *   there is no boundary to see.
 *
 * The lift is a single gain applied to all three channels, so it moves value
 * without moving hue.
 *
 * ## Measured
 *
 * Over 52 renders at 864x1184 — the 26 stored images plus every render from the
 * 2026-08-20 prompt trials — the top-left corner's deficit against the mean of
 * the other three went from a mean of -13.9 to -3.6, worst case -43.8 to -7.8,
 * and the count more than 10 levels off from 35 to 1. That one is a photograph
 * of a bicycle whose top-left is genuinely 38 levels *lighter* than the rest;
 * it comes through byte-identical, which is the artwork guards working.
 * Nothing overshoots: the most positive result across all 52 is +1.2.
 *
 * This runs *before* padding, which is what makes the two fit together: the
 * edge column the padding replicates outward has already been corrected, and
 * `padded`'s own clamp is left as the backstop for whatever residue reaches
 * below this window.
 */
const CORNER_WINDOW_FRACTION = 0.15;
const CORNER_CELL = 8;
/** Background grain measured at about +/-7 levels; ignore anything under this. */
const CORNER_TOLERANCE = 7;
/** A mass this far below its row is a thing, not a shadow. */
const CORNER_ARTWORK_DEFICIT = 90;
const CORNER_ARTWORK_FRACTION = 0.02;
/** The fraction of the window over which the correction fades out to nothing. */
const CORNER_TAPER = 0.25;
/** Side of the corner patches the top-left is judged against. */
const CORNER_PATCH = 24;

const median = (values: number[]): number => {
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
};

const taper = (t: number): number =>
    t <= 1 - CORNER_TAPER
        ? 1
        : 0.5 * (1 + Math.cos((Math.PI * (t - (1 - CORNER_TAPER))) / CORNER_TAPER));

function flattenTopLeftShadow(image: DecodedPng): DecodedPng {
    const { width, height, channels, pixels } = image;
    const windowWidth = Math.round(width * CORNER_WINDOW_FRACTION);
    const windowHeight = Math.round(height * CORNER_WINDOW_FRACTION);
    if (windowWidth < 2 * CORNER_CELL || windowHeight < 2 * CORNER_CELL)
        return image;

    const stride = width * channels;
    const lumaAt = (x: number, y: number): number => {
        const i = y * stride + x * channels;
        return luma(pixels[i], pixels[i + 1], pixels[i + 2]);
    };

    // What this row's ground should read as: the median of the band immediately
    // to the right of the window — past the artifact, still empty in the rows
    // this window covers, and close enough in x that a genuine left-to-right
    // gradient is shared rather than corrected away. Reading it from the far
    // side of the frame instead was measured to overshoot on images whose two
    // halves differ, lifting a corner that was already fine.
    // Is the top-left actually the odd corner out? This gate is what stops the
    // routine turning an image with a genuine all-round vignette into one lit
    // only in the top-left: there, the other three corners are equally dark, so
    // there is no asymmetry and nothing happens. It is a gate and deliberately
    // NOT a cap — scaling the correction by this ratio was tried and made the
    // result worse on 28 of 29 affected images (mean -3.1 to -7.8 levels),
    // because a patch-vs-patch asymmetry and a cell's median deficit against
    // its own row are not the same quantity and throttling one by the other
    // just under-corrects.
    const patch = (x0: number, y0: number): number => {
        let total = 0;
        for (let y = y0; y < y0 + CORNER_PATCH; y++)
            for (let x = x0; x < x0 + CORNER_PATCH; x++) total += lumaAt(x, y);
        return total / (CORNER_PATCH * CORNER_PATCH);
    };
    const far = width - CORNER_PATCH;
    const low = height - CORNER_PATCH;
    const asymmetry =
        (patch(far, 0) + patch(0, low) + patch(far, low)) / 3 - patch(0, 0);
    if (asymmetry <= CORNER_TOLERANCE) return image;

    const referenceTo = Math.min(width, windowWidth * 3);
    const rowReference = new Float64Array(windowHeight);
    for (let y = 0; y < windowHeight; y++) {
        const row: number[] = [];
        for (let x = windowWidth; x < referenceTo; x++) row.push(lumaAt(x, y));
        rowReference[y] = median(row);
    }

    const cols = Math.ceil(windowWidth / CORNER_CELL);
    const rows = Math.ceil(windowHeight / CORNER_CELL);
    const field = new Float64Array(cols * rows);
    let suspicious = 0;
    let counted = 0;

    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            const deficits: number[] = [];
            const yEnd = Math.min((j + 1) * CORNER_CELL, windowHeight);
            const xEnd = Math.min((i + 1) * CORNER_CELL, windowWidth);
            for (let y = j * CORNER_CELL; y < yEnd; y++) {
                for (let x = i * CORNER_CELL; x < xEnd; x++) {
                    const deficit = rowReference[y] - lumaAt(x, y);
                    deficits.push(deficit);
                    counted++;
                    if (deficit > CORNER_ARTWORK_DEFICIT) suspicious++;
                }
            }
            field[j * cols + i] = Math.max(0, median(deficits) - CORNER_TOLERANCE);
        }
    }

    if (suspicious > counted * CORNER_ARTWORK_FRACTION) return image;
    if (field[0] <= 0) return image;

    // Corner-anchored: nothing may exceed what lies between it and the corner.
    for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
            let value = field[j * cols + i];
            if (i > 0) value = Math.min(value, field[j * cols + i - 1]);
            if (j > 0) value = Math.min(value, field[(j - 1) * cols + i]);
            field[j * cols + i] = value;
        }
    }

    const sample = (x: number, y: number): number => {
        // Cell (i, j) speaks for its own centre; read between them.
        const fx = Math.min(Math.max(x / CORNER_CELL - 0.5, 0), cols - 1);
        const fy = Math.min(Math.max(y / CORNER_CELL - 0.5, 0), rows - 1);
        const i = Math.min(Math.floor(fx), cols - 1);
        const j = Math.min(Math.floor(fy), rows - 1);
        const i1 = Math.min(i + 1, cols - 1);
        const j1 = Math.min(j + 1, rows - 1);
        const tx = fx - i;
        const ty = fy - j;
        const top = field[j * cols + i] * (1 - tx) + field[j * cols + i1] * tx;
        const bottom = field[j1 * cols + i] * (1 - tx) + field[j1 * cols + i1] * tx;
        return top * (1 - ty) + bottom * ty;
    };

    const corrected = Buffer.from(pixels);
    for (let y = 0; y < windowHeight; y++) {
        const weightY = taper(y / windowHeight);
        for (let x = 0; x < windowWidth; x++) {
            const lift = sample(x, y) * weightY * taper(x / windowWidth);
            if (lift <= 0) continue;
            const i = y * stride + x * channels;
            const value = luma(pixels[i], pixels[i + 1], pixels[i + 2]);
            if (value <= 0) continue;
            const gain = (value + lift) / value;
            corrected[i] = clampByte(pixels[i] * gain);
            corrected[i + 1] = clampByte(pixels[i + 1] * gain);
            corrected[i + 2] = clampByte(pixels[i + 2] * gain);
        }
    }

    return { ...image, pixels: corrected };
}

/**
 * How far up and down an edge row looks when deciding what value its stretch of
 * padding ought to sit at. Wide enough that the corner shadow is a small
 * minority of the window (it is ~35 rows; this makes the window 301), narrow
 * enough that a real top-to-bottom gradient is still tracked locally.
 */
const EDGE_NEIGHBOURHOOD_RADIUS = 150;

/**
 * How much darker than its neighbourhood a padded row may be before it is
 * lifted. Comfortably above the edge column's own grain (~2%) and far below the
 * corner shadow (~30%).
 */
const EDGE_SHADOW_TOLERANCE = 0.05;

const luma = (r: number, g: number, b: number): number =>
    0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Per-row multipliers for the padding grown from column `x`, one per row.
 *
 * `1` for every row that already agrees with its neighbours — which is nearly
 * all of them — so the common case stays a plain copy. See the "Why a row is
 * not allowed to be much darker than its neighbours" section above.
 */
function edgeGains(
    { width, height, channels, pixels }: DecodedPng,
    x: number
): Float64Array {
    const stride = width * channels;
    const values = new Float64Array(height);
    for (let y = 0; y < height; y++) {
        const src = y * stride + x * channels;
        values[y] = luma(pixels[src], pixels[src + 1], pixels[src + 2]);
    }

    const gains = new Float64Array(height).fill(1);
    for (let y = 0; y < height; y++) {
        const from = Math.max(0, y - EDGE_NEIGHBOURHOOD_RADIUS);
        const to = Math.min(height, y + EDGE_NEIGHBOURHOOD_RADIUS + 1);
        const window = values.slice(from, to).sort();
        const median = window[window.length >> 1];
        const floor = median * (1 - EDGE_SHADOW_TOLERANCE);
        // One-sided and continuous: a row at exactly the floor gets 1, and no
        // row is ever darkened.
        if (values[y] > 0 && values[y] < floor) gains[y] = floor / values[y];
    }
    return gains;
}

const clampByte = (value: number): number =>
    value < 0 ? 0 : value > 255 ? 255 : Math.round(value);

function padded(image: DecodedPng): RgbRaster {
    const { width, height, channels, pixels } = image;
    const stride = width * channels;
    const size = height;
    const left = Math.floor((size - width) / 2);
    const outStride = size * 3;
    const rows = Buffer.alloc(height * (outStride + 1));

    const leftGains = edgeGains(image, 0);
    const rightGains = edgeGains(image, width - 1);

    for (let y = 0; y < height; y++) {
        const base = y * (outStride + 1);
        rows[base] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            // Clamp to the source's own columns: inside the image this is the
            // pixel itself, outside it repeats the nearest edge pixel of the
            // same row, carrying that row's gradient outward.
            const offset = x - left;
            const sx = Math.min(Math.max(offset, 0), width - 1);
            const src = y * stride + sx * channels;
            const out = base + 1 + x * 3;

            // Padding only — inside the frame the artwork is copied verbatim.
            const gain =
                offset < 0
                    ? leftGains[y]
                    : offset >= width
                      ? rightGains[y]
                      : 1;

            if (gain === 1) {
                rows[out] = pixels[src];
                rows[out + 1] = pixels[src + 1];
                rows[out + 2] = pixels[src + 2];
            } else {
                rows[out] = clampByte(pixels[src] * gain);
                rows[out + 1] = clampByte(pixels[src + 1] * gain);
                rows[out + 2] = clampByte(pixels[src + 2] * gain);
            }
        }
    }

    return { width: size, height, rows };
}

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

const crc32 = (buf: Buffer): number => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
};

const pngChunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
};

function encodeRgbPng({ width, height, rows }: RgbRaster): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // colour type: truecolour
    ihdr[10] = 0; // deflate
    ihdr[11] = 0; // adaptive filtering
    ihdr[12] = 0; // no interlace

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", deflateSync(rows, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}
