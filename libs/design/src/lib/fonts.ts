/**
 * The two typefaces, as `@font-face` rules both web surfaces can emit.
 *
 * Self-hosted rather than loaded from the Google Fonts CDN: fetching a font
 * from Google's servers leaks the visitor's IP to a third party, which the LG
 * München ruling treats as a GDPR violation. The subsets match what the client
 * loads through `@expo-google-fonts` — Poppins at the four working weights and
 * Lora at the three the editorial voice uses.
 *
 * `basePath` differs by surface (the site serves `/assets/fonts`, the console
 * `/fonts`) and is the only thing that does, which is why this is a function
 * rather than a constant. The FILES are the same bytes in both places; if a
 * weight is added, add it to `FONT_FILES` and copy it into both public dirs, or
 * the rule below points at a 404 and the browser silently falls back.
 */

/** Every file a surface has to serve for the rules below to resolve. */
export const FONT_FILES = [
    "poppins-400.woff2",
    "poppins-500.woff2",
    "poppins-600.woff2",
    "poppins-700.woff2",
    "lora-400.woff2",
    "lora-600.woff2",
    "lora-600-italic.woff2",
] as const;

interface Face {
    family: "Poppins" | "Lora";
    weight: 400 | 500 | 600 | 700;
    style: "normal" | "italic";
    file: string;
}

const FACES: Face[] = [
    { family: "Poppins", weight: 400, style: "normal", file: "poppins-400.woff2" },
    { family: "Poppins", weight: 500, style: "normal", file: "poppins-500.woff2" },
    { family: "Poppins", weight: 600, style: "normal", file: "poppins-600.woff2" },
    { family: "Poppins", weight: 700, style: "normal", file: "poppins-700.woff2" },
    { family: "Lora", weight: 400, style: "normal", file: "lora-400.woff2" },
    { family: "Lora", weight: 600, style: "normal", file: "lora-600.woff2" },
    { family: "Lora", weight: 600, style: "italic", file: "lora-600-italic.woff2" },
];

export function fontFaceCss(basePath: string): string {
    const base = basePath.replace(/\/+$/, "");

    return FACES.map(
        ({ family, weight, style, file }) =>
            `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};` +
            `font-display:swap;src:url(${base}/${file}) format('woff2')}`
    ).join("\n");
}

/**
 * The two faces worth preloading, as `<link rel="preload">` elements.
 *
 * Only two: a preload is a promise that the file is needed for the first paint,
 * and preloading all seven would have the browser fetch the italic and both
 * upright Loras before the headline they are not in. These are the body and the
 * heading weight of the sans, which every surface paints immediately.
 */
export function fontPreloadTags(basePath: string): string {
    const base = basePath.replace(/\/+$/, "");

    return ["poppins-700.woff2", "poppins-400.woff2"]
        .map(
            (file) =>
                `<link rel="preload" href="${base}/${file}" as="font" type="font/woff2" crossorigin>`
        )
        .join("\n");
}
