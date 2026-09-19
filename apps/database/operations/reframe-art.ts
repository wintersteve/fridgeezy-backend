// Load environment variables first (auto-loads when imported)
import "dotenv/config";

import { isAbsolute, join } from "node:path";

/**
 * Makes the drawn subject occupy less of the frame, by measurement rather than
 * by asking.
 *
 * ## Why this is not done in the prompt
 *
 * Because the prompt cannot do it, and that is now measured twice. The framing
 * line has always asked for the vessel to fill "about two thirds of the frame's
 * width"; `create-recipe-image` already recorded that rewording it between two
 * thirds and three quarters moved nothing. Re-measured on 2026-09-19: rendered
 * with no references at all it comes out at 81-85% of the width, and rewritten
 * to demand HALF the frame with an explicit check ("if the vessel nearly
 * touches the left and right thirds it is too big") four rolls came back at
 * 89-92% — bigger, if anything. The model draws food at about four fifths of
 * the frame whatever it is told, and style anchors only reinforce whatever they
 * themselves do.
 *
 * ## How, and why this fill and no other
 *
 * Shrink the whole picture, then give back the border it lost as a FLAT band of
 * the ground sampled from the picture's own corner.
 *
 * Both other fills were tried on the same image and both failed visibly. A
 * MIRROR is seamless by construction and useless here: the subject fills ~89%
 * of the width, so the band being reflected contains the plate, and it comes
 * back as two ghost plates either side. REPLICATING the edge columns outward is
 * the technique `create-recipe-image` records removing for its artefacts, and
 * it smears for the same reason.
 *
 * A flat band is the thing `art-direction` warns about — "a texture that stops
 * inside the frame is a paper edge" — and at this size it does not read as one:
 * the tooth is a very low-contrast grain, the band is under an eighth of the
 * width, and the colour is sampled per image rather than assumed, so it matches
 * that picture's own ground exactly. It was eyeballed at both 0.65 and 0.72
 * before being written down. **If the band ever needs to be much wider than
 * this, look again** — the argument is about size, not principle.
 *
 * Usage:
 *   npx jiti operations/reframe-art.ts --file=in.jpg --out=out.jpg --target=0.65
 */

const arg = (name: string) =>
    process.argv
        .find((a) => a.startsWith(`--${name}=`))
        ?.split("=")
        .slice(1)
        .join("=");

const FILE = arg("file");
const OUT = arg("out");
const TARGET = Number(arg("target") ?? 0.65);

const resolve = (p: string) => (isAbsolute(p) ? p : join(process.cwd(), p));

/** The constructor, not the module namespace — `sharp(...)` is the default export. */
type Sharp = (typeof import("sharp"))["default"];

/**
 * How much of the frame's width the drawn subject spans.
 *
 * The threshold is deep on purpose: it finds the linework, not the soft cast
 * shadow, which spreads to one side and would report the subject as wider than
 * anybody sees it.
 */
async function subjectWidth(
    sharp: Sharp,
    file: string
): Promise<number> {
    const { data, info } = await sharp(file)
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

    return (right - left) / info.width;
}

/** The ground, taken from a corner the subject never reaches. */
async function groundColour(sharp: Sharp, file: string) {
    const { data, info } = await sharp(file)
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

async function main() {
    if (!FILE || !OUT) {
        console.error("Usage: --file=<in> --out=<out> [--target=0.65]");
        process.exitCode = 1;
        return;
    }

    // Deferred as `encodeRecipeImageVariants` defers it — a ~30 MB native
    // module an operation should not load before it knows it will encode.
    const { default: sharp } = await import("sharp");

    const src = resolve(FILE);
    const measured = await subjectWidth(sharp, src);

    if (measured <= TARGET) {
        console.log(
            `${FILE.split("/").pop()}: subject already ${(measured * 100).toFixed(0)}% — nothing to do`
        );
        return;
    }

    // See `reframeSubject`'s EDGE_TO_EDGE: past this the outermost ink is a
    // drawn border rather than the dish, and shrinking frames the picture
    // inside a second frame.
    if (measured > 0.93) {
        console.log(
            `${FILE.split("/").pop()}: subject spans ${(measured * 100).toFixed(0)}% — something reaches the edge, probably a drawn border. Left alone.`
        );
        return;
    }

    const meta = await sharp(src).metadata();
    const background = await groundColour(sharp, src);
    const scale = TARGET / measured;
    const width = Math.round(meta.width * scale);
    const height = Math.round(meta.height * scale);
    const dx = Math.round((meta.width - width) / 2);
    const dy = Math.round((meta.height - height) / 2);

    const body = await sharp(src).resize(width, height).toBuffer();
    await sharp(body)
        .extend({
            top: dy,
            bottom: meta.height - height - dy,
            left: dx,
            right: meta.width - width - dx,
            background,
        })
        .jpeg({ quality: 92 })
        .toFile(resolve(OUT));

    const after = await subjectWidth(sharp, resolve(OUT));
    console.log(
        `${FILE.split("/").pop()?.padEnd(24)} ${(measured * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}%   band ${dx}px of ground rgb(${background.r},${background.g},${background.b})`
    );
}

void main();
