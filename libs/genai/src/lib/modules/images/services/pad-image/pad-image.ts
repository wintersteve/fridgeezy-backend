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
        return encodeRgbPng(padded(image));
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

function padded({ width, height, channels, pixels }: DecodedPng): RgbRaster {
    const stride = width * channels;
    const size = height;
    const left = Math.floor((size - width) / 2);
    const outStride = size * 3;
    const rows = Buffer.alloc(height * (outStride + 1));

    for (let y = 0; y < height; y++) {
        const base = y * (outStride + 1);
        rows[base] = 0; // filter: none
        for (let x = 0; x < size; x++) {
            // Clamp to the source's own columns: inside the image this is the
            // pixel itself, outside it repeats the nearest edge pixel of the
            // same row, carrying that row's gradient outward.
            const sx = Math.min(Math.max(x - left, 0), width - 1);
            const src = y * stride + sx * channels;
            const out = base + 1 + x * 3;
            rows[out] = pixels[src];
            rows[out + 1] = pixels[src + 1];
            rows[out + 2] = pixels[src + 2];
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
