import { buildFoodIllustrationStyle } from "@fridgeezy/genai";
import { generateCompletion } from "@fridgeezy/llm";

/**
 * The model that decides WHAT to draw for a verb, before anything is drawn.
 *
 * Small and cheap, and it is the single highest-leverage thing in this module.
 * The six paintings that shipped bundled were prompted by hand, one scene
 * written per verb, and the difference between the good ones and the rejected
 * one was entirely in the scene rather than in the style: `fold` came back as a
 * spatula standing upright in a swirled bowl, which is a picture of STIRRING —
 * the exact thing folding is defined against — and it had to be withheld.
 *
 * A template cannot make that judgement. "Deglaze: add liquid to dissolve
 * browned bits" has to become a pan caught half-lifted, dry on one side and
 * swirling on the other, and choosing that moment is a reasoning task. So one
 * cheap text call composes the subject and the expensive image call draws it.
 * It is paid once per verb, ever.
 */
const SCENE_MODEL = process.env.TECHNIQUE_SCENE_MODEL || "gpt-4.1-mini";

/**
 * Long enough for a real scene with a tool, a food and a moment in it; short
 * enough that it cannot start rewriting the style block underneath it.
 */
const MAX_SCENE_CHARS = 700;

/**
 * What the scene call is told, and every clause in it was bought by a render.
 *
 * The house art direction bans hands, tools and identifiable ingredients, which
 * is right for cook mode — a band above a specific dish, where a named
 * ingredient is a claim about what the reader is cooking. It is wrong for a
 * definition: the definition of grating is cheese against a grater. That ban is
 * lifted for this surface and the rules below are what replace it.
 */
const SCENE_PROMPT = [
    "You are art-directing ONE illustration that has to teach a cook what a single cooking technique means, in a recipe app. The picture sits above a one-line definition, and a reader who has never heard the word should recognise what is being done from the picture alone.",
    "",
    "Write the SUBJECT section of an image prompt: 3 to 5 short bullet lines, nothing else. No title, no style notes, no colours, no lighting, no camera — those are supplied separately and anything you say about them will fight them.",
    "",
    "RULES, all of which are load-bearing:",
    "- Name a REAL, ordinary food and, where the action needs one, a REAL tool. Be specific: a wedge of hard cheese, half an onion, a thick steak. Vague 'food' produces an abstract blob that teaches nobody anything.",
    "- Choose the food a cook would most expect for this action, not an unusual one. The picture is a definition, so it should be the typical case.",
    "- Show the action MID-WAY THROUGH, not finished. Something must be visibly in contact or in motion — falling, cutting through, being lifted, hitting the heat. A finished result sitting on a plate is the failure mode: a seared steak and a raw steak on a plate differ by a brown edge and neither says 'sear'.",
    "- If the action has no moment to catch — it takes twenty minutes, or it is done with bare hands — show its TRACE instead: the mark it leaves. A tide line high on a pan wall says a liquid reduced; a fold and a drag through flour says dough was kneaded. Say explicitly that the evidence is the subject.",
    "- The strongest shape in the picture must be the thing that distinguishes this action from its nearest neighbour. Say which shape that is. Folding is not stirring, searing is not frying, dicing is not slicing — draw the difference.",
    "- AT MOST ONE tool, plus at most one plain board or one plain vessel if the action needs somewhere to happen. Two tools is a kitchen scene, and a kitchen scene is not a definition.",
    "- NO hands, arms, sleeves or people anywhere, ever. If the action is done by hand, show what the hands left behind.",
    "- No hob, flame, worktop, cloth, packaging, jars, labels, text or props.",
    "- A technique with TWO STAGES — boil then chill, sear then braise, mix then rest — is still ONE picture of ONE moment, and that moment is the TRANSFER between the stages: the thing being lifted out of the first and into the second, caught in the air. Never show the two stages side by side as halves of the frame, and never draw a seam, edge or divider between them.",
    "- End with a line stating that this is ONE single continuous illustration of ONE moment, never a grid, sequence, panel, diptych, before-and-after or set of steps, and that no line, seam or border divides the frame.",
].join("\n");

/**
 * The style block, with the one sentence that forbids the whole idea swapped
 * out.
 *
 * Only the banned-noun list moves. Camera, palette, light, tone and the
 * watercolour medium are untouched, so a technique plate still looks like it
 * came from the same kitchen as every recipe hero — which is the entire reason
 * this is a targeted replacement rather than a second style block that would
 * immediately drift.
 *
 * The two `vessel` branches word that ban DIFFERENTLY, and a single literal
 * silently matched only one of them the first time this was written. Both are
 * listed, and a miss throws rather than quietly generating a picture with no
 * tool in it — which is the one failure that would look like working software.
 */
const BANNED_NOUNS = [
    "No table surface, marble, wood grain, cloth, cutlery, napkins, hands, or stray garnish outside the vessel.",
    "no table surface, marble, wood grain, cloth, cutlery, napkins or hands, ever.",
];

const DEPICTIVE_GROUND = `Exactly ONE tool may appear — the one this action is performed with — plus, where the action needs it, ONE plain pale board or ONE plain ceramic vessel. The tool is drawn in the same sparse warm-grey linework as everything else and is never the brightest or hardest object in the picture. No hands, arms, sleeves or people anywhere. No marble, wood grain, cloth, napkins, tiles, worktops, hobs, packaging, jars, labels or props of any kind, and no second tool.`;

/**
 * The ground these are painted on, and the ONE place the technique set departs
 * from the house art direction's colour.
 *
 * Every other illustration in the app is painted on the direction's warm cream
 * (`#FDFBF9`, which the model returns a couple of steps warmer still). These are
 * painted on the light theme's `surface` instead, because of where they are
 * drawn: a technique plate sits inside a chat reply, framed, a few points from
 * the page — an object in the UI rather than a picture of food on a shelf. A
 * cooler, cleaner ground is what makes it read as a printed plate rather than
 * as another warm card in a column of warm cards.
 *
 * **It is a literal, not `surface` itself, and it has to be.** An image is one
 * file with an opaque ground baked into it; `surface` is a theme token that
 * flips to `#26201C`. So this can only ever be one of the two, and the light
 * one is chosen for the same reason every other asset in the app bakes cream:
 * the dark theme treats artwork as a LIT OBJECT on a dark page rather than a
 * hole in it — the whole argument the `onArtwork*` tokens exist for. A white
 * plate on a near-black page is that, slightly cooler than the cream one it
 * replaces.
 *
 * A genuine dark-theme variant is possible and is a different job: it means a
 * second render per verb and `tone: "low-key"`, which swaps the medium from
 * watercolour to opaque gouache — four of the eight fixed style lines — so the
 * two sets would not look like one another. See `welcome-light`/`welcome-dark`,
 * the only pair in the app that pays that price.
 *
 * **The client's backdrop token must agree with whatever this is.** The plate
 * paints `artworkGroundCool` behind the picture, which shows in the sliver the
 * corner radius leaves; if this hex moves, re-sample that one. Its sibling
 * `artworkGround` says the same thing about the cream set.
 */
const GROUND = { name: "soft white", hex: "#FFFFFF" };

const depictiveStyle = (): string => {
    const style = buildFoodIllustrationStyle({
        vessel: "none",
        ground: GROUND,
        framing:
            "the subject is centred and fills about three quarters of the frame's width, with a generous, even margin of empty ground around it. Nothing is cropped by an edge.",
        renderingEmphasis:
            "The one shape that distinguishes this action is drawn with more definition than anything else in the picture, so it reads at a glance at thumbnail size.",
        mood: "mid-gesture — the moment the action is happening.",
    });

    const banned = BANNED_NOUNS.find((sentence) => style.includes(sentence));

    if (!banned) {
        throw new Error(
            "The shared background rule no longer contains a known banned-noun sentence — re-read libs/genai art-direction and update BANNED_NOUNS.",
        );
    }

    return style.replace(banned, DEPICTIVE_GROUND);
};

export interface TechniqueForArt {
    /** Canonical `cooking_actions.name`, e.g. `deglaze`. */
    name: string;
    /** The curated one-liner, e.g. "Add liquid to dissolve browned bits". */
    description: string | null;
    /** The curated tip, which often names the tool or the failure mode. */
    tips: string | null;
}

/**
 * The scene, composed. Never throws — a failed scene call falls back to a
 * description built straight from the curated columns, which is a worse picture
 * rather than no picture.
 */
const composeScene = async (action: TechniqueForArt): Promise<string> => {
    const brief = [
        `Technique: ${action.name.replace(/_/g, " ")}`,
        action.description ? `Means: ${action.description}` : null,
        action.tips ? `Cook's tip: ${action.tips}` : null,
    ]
        .filter(Boolean)
        .join("\n");

    try {
        const { text } = await generateCompletion({
            model: { openai: SCENE_MODEL },
            system: SCENE_PROMPT,
            user: brief,
            label: "techniques.compose_scene",
        });

        const scene = text.trim();

        if (scene) return scene.slice(0, MAX_SCENE_CHARS);
    } catch (error) {
        console.error("[techniqueArt] scene composition failed:", error);
    }

    // The floor. It keeps the rules that matter most — one tool, no hands,
    // mid-action — and loses only the choice of what to put in frame.
    return [
        `- ONE ordinary food being ${action.name.replace(/_/g, " ")}ed, caught part way through the action rather than finished.`,
        action.description ? `- The action is: ${action.description}.` : null,
        "- At most ONE plain tool and ONE plain board or vessel. No hands, arms or people anywhere.",
        "- This is ONE single continuous illustration of ONE moment — never a grid, sequence or set of panels.",
    ]
        .filter(Boolean)
        .join("\n");
};

/**
 * The finished image prompt for a technique: a composed subject over the shared
 * style block.
 */
export const buildTechniqueArtPrompt = async (
    action: TechniqueForArt,
): Promise<string> =>
    [
        `Editorial illustration teaching what it means to ${action.name.replace(/_/g, " ")} in cooking.`,
        "",
        "SUBJECT",
        await composeScene(action),
        "",
        depictiveStyle(),
    ].join("\n");
