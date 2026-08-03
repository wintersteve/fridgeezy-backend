/**
 * The art direction every Fridgeezy food illustration shares.
 *
 * This exists as one exported string because the two call sites — recipe hero
 * images and the home feed's cuisine tiles — render side by side in the app and
 * previously held two hand-maintained copies of the same paragraph. They drifted:
 * the recipe prompt lost the palette hex codes the cuisine one kept, and started
 * producing a green plate on marble for one dish and a speckled rustic bowl for
 * the next. Constants that must agree should not be prose in two files.
 *
 * Everything here is deliberately a *constant*, not a preference. Left to choose,
 * the model varies the vessel, surface, light and palette per dish, and any two
 * cards in the same feed stop looking like they came from one kitchen. The hex
 * codes are the client's own `COLORS` tokens; naming "soft peach" in words
 * instead of #F4A67A is what let the palette drift in the first place.
 *
 * The palette is pinned to the vessel, ground and linework *only*. When it was
 * applied to the whole image the food inherited it — a tiramisu came back
 * garnished with peach shards.
 */
export interface FoodIllustrationStyleOptions {
    /**
     * How the vessel sits in the frame. The one genuinely per-surface rule: a
     * 3:4 recipe hero is centre-cropped three ways by the client and needs an
     * even margin to survive, while a small cuisine tile is cropped hard enough
     * that a floating, generously-margined plate leaves mostly background.
     */
    framing: string;
    /** One line, appended after the style block. */
    mood: string;
}

/**
 * Emits the style block, the mood line and the no-text constraint in that
 * order. The trailer is part of the builder rather than something call sites
 * append because the negative constraint has to stay the *last* thing in the
 * prompt — that is the ordering the A/B rounds were run against, and the run
 * that framed an image had no such line at all.
 */
export const buildFoodIllustrationStyle = ({
    framing,
    mood,
}: FoodIllustrationStyleOptions): string =>
    `FIXED STYLE — identical in every image
- Camera: perfectly overhead bird's-eye, 90 degrees, no perspective tilt.
- Vessel: matte handmade ceramic in creamy off-white (#FFF5EE) with subtle artisanal texture and a slightly irregular hand-thrown rim. Its shape follows the dish (flat plate, shallow bowl, deep bowl); its material and colour never change. Use plain clear glassware only for drinks and layered desserts.
- Framing: ${framing}
- Background: flat, lightly textured warm cream (#FDFBF9), completely empty. No table surface, marble, wood grain, cloth, cutlery, napkins, hands, or stray garnish outside the vessel. No borders, frames or inset panels — the background runs to all four edges of the image.
- Light: soft diffuse studio daylight from the upper left, casting exactly one gentle, soft-edged, low-contrast shadow from the vessel toward the lower right. No other shadows anywhere — no dappled light, no foliage or window patterns, no shadows from objects outside the frame. No hard specular highlights.
- Palette: the vessel, background and linework are fixed — cream #FFF5EE, warm stone #FAF8F6, ground #FDFBF9, with deep charcoal #060606 only as sparse linework; peach #F4A67A and sage green #93C5A8 are the accent tones. The food keeps its own true colours, rendered in the same warm, slightly muted register. No harsh black, no saturated primaries, no neon.
- Rendering: refined modern editorial illustration — soft hand-drawn linework, gentle gouache-like shading, clean flat-leaning shapes; minimal but warm. Not photorealistic, not 3D-rendered, not cartoonish.

Mood: ${mood}

Render the illustration only. No text, letters, numbers, labels, logos, watermarks, borders or frames.`;
