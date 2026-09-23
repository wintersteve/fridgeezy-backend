import { TOKENS } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { Fragment } from "react";

import { CONTAINER_SX, DOWNLOAD_HREF, renderPage, SITE_NAME } from "./chrome";
import { buildTimeline, formatClockOffset, formatSpan } from "./timeline";

/**
 * A recipe, on the web.
 *
 * ## What this page is FOR
 *
 * The landing page's third step claims "A recipe, not an essay", and until this
 * existed the only evidence was a 248px screenshot nobody can read a word of.
 * This is the claim made checkable: the amounts, the nutrition per serving, the
 * steps with their timings, in the product's own type. A visitor can decide
 * whether the recipes are any good before installing anything, which is the
 * one question the rest of the site asks them to take on faith.
 *
 * Nothing is given away by it. A catalogue recipe is world-readable by design —
 * `recipe_instructions` carries no RLS for reading and the client's own note
 * puts the teaser boundary at `generate` vs `suggest`, not at web vs app. What
 * the app sells is the loop around the recipe: the fridge, the ideas, cook
 * mode, the menu on one clock.
 *
 * ## It takes a RECIPE, not an id
 *
 * The renderer knows nothing about where its data came from — `example-recipe.ts`
 * hands it a committed fixture today, and a catalogue build would hand it rows.
 * That is deliberate: it is the difference between this being an example and
 * this being the start of a web catalogue, and the second should be a decision
 * rather than something that happens by accident. See the fixture's header for
 * what the second one costs.
 *
 * ## The JSON-LD is the point as much as the page
 *
 * `schema.org/Recipe` is what lets a search engine render this as a rich
 * result, and it is the only content on this site anybody would ever search
 * for. It is emitted from the SAME object the page renders, so the two cannot
 * describe different dishes.
 */

export interface ExampleRecipeIngredient {
    name: string;
    quantity: number | null;
    unit: string | null;
    /** The unit's kind, from the `units` table — `count`, `mass`, `volume`. */
    unitType: string | null;
    note: string | null;
}

export interface ExampleRecipeStep {
    number: number;
    /** The step's own artwork, where the catalogue has one. */
    image?: string;
    title: string | null;
    text: string;
    durationSeconds: number | null;
    temperatureC?: number;
    equipment?: string[];
}

export interface ExampleRecipe {
    id: string;
    slug: string;
    name: string;
    shortDescription: string;
    description: string;
    cuisine: string;
    difficulty: string;
    servings: number;
    prepTime: string;
    cookTime: string;
    totalTimeMinutes: number;
    nutrition: { kcal: number; carbs: number; protein: number; fat: number };
    image: string;
    tags: { type: string; name: string }[];
    ingredients: ExampleRecipeIngredient[];
    steps: ExampleRecipeStep[];
    tips: string[];
    /** When the fixture was taken from the catalogue. Shown, not hidden. */
    capturedOn: string;
}

/** "nut free" -> "Nut Free", which is how the app sets a tag. */
const titleCase = (value: string) =>
    value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

/**
 * The word the app prints for a level, from `@fridgeezy/schemas`.
 *
 * NOT title-cased from the enum: the literal and the word on screen stopped
 * being the same thing when `easy` became "Home" — printing "Easy" tells
 * somebody the proper recipe is the dumbed-down one.
 */
const DIFFICULTY_LABEL: Record<string, string> = {
    easy: "Home",
    medium: "Restaurant",
    hard: "Fine Dining",
};

/** The chip's ink and ground per level — `useDifficultyChipColors` in the app. */
const DIFFICULTY_COLOURS: Record<string, { ink: string; ground: string }> = {
    easy: { ink: TOKENS.difficultyEasy, ground: TOKENS.difficultyEasyBg },
    medium: { ink: TOKENS.difficultyMedium, ground: TOKENS.difficultyMediumBg },
    hard: { ink: TOKENS.difficultyHard, ground: TOKENS.difficultyHardBg },
};

/**
 * `2h 25m` — the app's `formatTotalTime`, to the character.
 *
 * `h`/`m` rather than "hr"/"min", and never "2:14": a colon at chip size reads
 * as a clock time rather than a duration. Each unit is closed up to its own
 * number with one space between the pairs, which is what keeps the figure
 * legible as one value without it running together as a word.
 */
function formatTotalTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);

    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}h`;

    return `${hours}h ${minutes}m`;
}

/**
 * The macro colours, RANKED rather than fixed — `NutrientsSection`'s rule.
 *
 * Kcal is always the accent. The other three are sorted by the share of the
 * calories they account for (carbs and protein at 4 kcal/g, fat at 9) and take
 * the difficulty ramp in that order: the smallest contributor green, the
 * middle amber, the largest rose. So the colours say something about THIS dish
 * rather than being three decorative hues, and a fat-heavy recipe and a
 * carb-heavy one are coloured differently.
 *
 * Computed here rather than baked into the fixture, so a second recipe is
 * coloured correctly without anybody remembering to.
 */
function macroColours(n: ExampleRecipe["nutrition"]): Record<string, string> {
    const shares = [
        { key: "carbs", share: (n.carbs * 4) / n.kcal },
        { key: "protein", share: (n.protein * 4) / n.kcal },
        { key: "fat", share: (n.fat * 9) / n.kcal },
    ].sort((a, b) => a.share - b.share);

    const ramp = [TOKENS.difficultyEasy, TOKENS.difficultyMedium, TOKENS.difficultyHard];

    return {
        kcal: TOKENS.primary,
        ...Object.fromEntries(shares.map(({ key }, index) => [key, ramp[index]])),
    };
}

/**
 * `PT2H25M`, which is the only duration format schema.org accepts.
 *
 * The zero case is handled explicitly rather than with a `||` fallback on the
 * template: a template literal is never empty — it would be the string "PT" —
 * so the fallback could not fire and a timeless recipe would emit a duration no
 * parser accepts. eslint caught that; it is not a hypothetical.
 */
function isoDuration(minutes: number): string {
    if (minutes <= 0) return "PT0M";

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    return `PT${hours ? `${hours}H` : ""}${rest ? `${rest}M` : ""}`;
}

/**
 * The amount, as one string.
 *
 * A null quantity is a real case — "salt, to taste" — and renders as nothing
 * rather than as "null" or a stray unit.
 *
 * A COUNT unit is dropped, which is what the app does and is the reason this
 * needs the unit's type rather than just its abbreviation: two chicken breasts
 * are "2", not "2 pc". Printing it reads like a stock code, and it would go
 * into the structured data too, where "2 pc Chicken Breast" is what a search
 * result would quote back at somebody.
 */
export function amount({ quantity, unit, unitType }: ExampleRecipeIngredient): string {
    if (quantity === null) return "";
    if (!unit || unitType === "count") return `${quantity}`;

    return `${quantity} ${unit}`;
}

export const RECIPE_STYLES = `
.recipe-hero{
  display:grid;gap:24px;align-items:center;
  padding:24px 0 8px;
}
.recipe-hero img{
  width:100%;max-width:420px;border-radius:var(--r-xxl);
  box-shadow:var(--shadow-floating);justify-self:center;
}
@media (min-width: 860px){
  .recipe-hero{grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:48px;padding:40px 0 16px}
  .recipe-hero img{max-width:none}
}

/* The line under the dish's name: a level pill, a figure, the dietary tags.
   A small gap between the items and no middots: punctuation belongs between words,
   and set against a chip's edge it reads as a stray mark rather than as a
   separator. */
.meta-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px}
.meta-row .chip{
  display:inline-flex;align-items:center;gap:4px;
  min-height:18px;padding:2px 8px;border-radius:var(--r-pill);
  font-size:11px;font-weight:600;line-height:14px;letter-spacing:.5px;
}
.meta-row .time{font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--ink-mid)}

/* NutrientsSection, to the point: ONE card divided into four equal columns by
   hairlines that run the full inner height. They were four separate cards once,
   each shrink-wrapped to its own figure — three gaps and four borders around
   what is a single table of one recipe's numbers, with ragged columns because
   each sized itself. The padding is the COLUMNS' rather than the card's, which
   is what leaves the rules the whole height to fill. */
.nutrition{
  display:flex;align-items:stretch;
  margin:20px 0 0;
  background:var(--surface);border:1px solid var(--outline);
  border-radius:var(--r-xl);box-shadow:var(--shadow-rest);
}
.nutrition div{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:2px;padding:12px 0;text-align:center;
}
.nutrition .rule{flex:none;width:1px;background:var(--rule)}
.nutrition b{font-size:20px;font-weight:700;line-height:24px}
.nutrition span{font-size:10px;font-weight:600;line-height:14px}

.ingredient-row{
  display:flex;gap:16px;align-items:baseline;justify-content:space-between;
  padding:11px 0;border-bottom:1px solid var(--outline);
}
.ingredient-row:last-child{border-bottom:0}
.ingredient-row .amount{
  flex:none;font-weight:600;font-size:14px;color:var(--ink-strong);
  font-variant-numeric:tabular-nums;
}

/* ---------- the timeline ---------- */
/* Three figures on their own surface, the same shape as the nutrition card
   above — this page reports two sets of numbers and they should read as the
   same kind of object. */
.span-summary{display:flex;align-items:stretch;margin-bottom:8px}
.span-summary div{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:2px;padding:14px 4px;text-align:center;
}
.span-summary div + div{border-left:1px solid var(--rule)}
.span-summary b{font-size:19px;font-weight:700;line-height:24px;color:var(--ink-strong)}
.span-summary span{
  font-size:10px;font-weight:600;line-height:14px;letter-spacing:1px;
  text-transform:uppercase;color:var(--ink-muted);
}

.timeline{padding:4px 0}
/* Clock, rail, step. The rail is a fixed column so every bar is measured from
   the same left edge — the axis only reads as an axis if they line up. */
.tl-row{display:grid;grid-template-columns:38px 14px minmax(0,1fr);gap:12px;min-height:56px}
.tl-clock{
  font-size:11px;font-weight:600;letter-spacing:.5px;color:var(--ink-muted);
  padding-top:2px;font-variant-numeric:tabular-nums;text-align:right;
}
/* The rail runs the full row height and the bar sits inside it, so the GAP
   between two bars is the join between two steps rather than a margin. */
.tl-rail{position:relative;display:flex;justify-content:center}
.tl-rail::before{
  content:"";position:absolute;inset:0;width:2px;left:50%;margin-left:-1px;
  background:var(--outline-solid);
}
.tl-bar{
  position:relative;width:6px;min-height:6px;border-radius:3px;
  background:var(--primary);align-self:flex-start;
}
/* Hands-off time is drawn hollow: the evening is paying for it and the cook is
   not, which is the distinction the summary above is built on. */
.tl-bar.is-waiting{background:var(--primary-container);box-shadow:inset 0 0 0 1.5px var(--primary)}
.tl-bar.is-parallel{background:var(--secondary)}
.tl-bar.is-empty{background:var(--outline-solid)}
.tl-body{padding:0 0 18px}
.tl-title{
  font-family:var(--serif);font-size:16px;line-height:22px;color:var(--ink-strong);
}
.tl-meta{
  display:block;margin-top:2px;
  font-size:11px;font-weight:600;letter-spacing:.5px;
  text-transform:uppercase;color:var(--ink-muted);
}
.tl-tag{
  display:inline-block;margin-bottom:4px;
  font-size:10px;font-weight:600;letter-spacing:1px;
  text-transform:uppercase;color:var(--secondary-ink);
}
.tl-foot{display:block;margin-top:8px;color:var(--ink-muted)}
.tl-foot a{color:var(--primary-ink);font-weight:600}
`;

/**
 * The three ascending bars every surface in the app uses to report a level —
 * `signal-cellular-N`, the one glyph family that draws the SAME bars at three
 * fill levels, which is what makes a grid of cards read as points on one scale.
 * The unfilled bars are the same mark at low opacity rather than a second
 * colour, so the chip stays two-tone.
 */
const DifficultyBars = ({ level, colour }: { level: string; colour: string }) => {
    const filled = level === "hard" ? 3 : level === "medium" ? 2 : 1;

    return (
        <Box
            component="svg"
            viewBox="0 0 12 10"
            aria-hidden="true"
            sx={{ width: 11, height: 9, flex: "none" }}
        >
            {[0, 1, 2].map((index) => (
                <rect
                    key={index}
                    x={index * 4.5}
                    y={6 - index * 3}
                    width="3"
                    height={4 + index * 3}
                    rx="1"
                    fill={colour}
                    opacity={index < filled ? 1 : 0.28}
                />
            ))}
        </Box>
    );
};

/**
 * The line between the dish's name and its description, which is the recipe
 * screen's own: the level as a coloured pill, the total time as plain text,
 * then the dietary tags.
 *
 * Two deliberate departures from the app, both because this is a PAGE and not
 * a card:
 *
 *  - **The tags are named rather than counted.** The app draws "Nut Free +3",
 *    because a phone's metadata line is a fixed height that a wrapping chip
 *    would grow. There is room here, and a named tag is the one item on this
 *    line whose value is not already legible from what led the reader to it —
 *    a level and a time are two short figures, where "Shellfish Free" is a
 *    fact about the dish nothing else on the page states.
 *  - **No chevrons.** In the app both pills open something — the level picks a
 *    rung, the count expands the list — and the chevron is what says so.
 *    Nothing here opens, so drawing one would be a control that isn't.
 */
const MetaRow = ({ recipe }: { recipe: ExampleRecipe }) => {
    const level = DIFFICULTY_COLOURS[recipe.difficulty];
    const dietary = recipe.tags.filter((tag) => tag.type === "dietary");

    return (
        <Box className="meta-row">
            {level ? (
                <span className="chip" style={{ background: level.ground, color: level.ink }}>
                    <DifficultyBars level={recipe.difficulty} colour={level.ink} />
                    {DIFFICULTY_LABEL[recipe.difficulty] ?? recipe.difficulty}
                </span>
            ) : null}

            {/* Plain text, not a pill. The app's rule for this line is one
                sentence long — what DOES something wears a pill, what reports a
                value is text — and on the page the level is a control. Here
                nothing is, so the distinction survives only as the level being
                the one fact worth ranking at a glance. */}
            <span className="time">{formatTotalTime(recipe.totalTimeMinutes)}</span>

            {dietary.map((tag) => (
                <span
                    key={tag.name}
                    className="chip"
                    style={{
                        background: TOKENS.secondaryContainer,
                        color: TOKENS.secondaryInk,
                    }}
                >
                    {titleCase(tag.name)}
                </span>
            ))}
        </Box>
    );
};

const Section = ({
    title,
    id,
    children,
}: {
    title: string;
    id?: string;
    children: React.ReactNode;
}) => (
    <Box id={id} sx={{ mt: { xs: 10, md: 14 }, scrollMarginTop: 80 }}>
        <Typography variant="h2" component="p" sx={{ mb: 3 }}>
            {title}
        </Typography>
        {children}
    </Box>
);

const RecipePage = ({ recipe }: { recipe: ExampleRecipe }) => {
    const colours = macroColours(recipe.nutrition);
    const timeline = buildTimeline(recipe.steps);
    // The scale the bars are drawn against. The longest single step, not the
    // total: against the total every bar but the marinade would be a sliver.
    const longest = Math.max(...timeline.entries.map((entry) => entry.seconds), 1);

    return (
    <Box component="main">
        <Container maxWidth="lg" disableGutters className="container" sx={CONTAINER_SX}>
            <Box className="recipe-hero">
                <img
                    src={recipe.image}
                    alt={recipe.name}
                    width="896"
                    height="1200"
                    // The one picture above the fold on this page.
                    fetchPriority="high"
                    decoding="async"
                />
                <Box>
                    <Typography variant="h2" component="p" sx={{ mb: 1.5 }}>
                        {recipe.cuisine} · {recipe.tags.find((t) => t.type === "course")?.name}
                    </Typography>
                    <Typography
                        variant="h1"
                        sx={{
                            fontFamily: TOKENS.serif,
                            fontSize: { xs: 34, md: 44 },
                            lineHeight: 1.12,
                            mb: 3,
                        }}
                    >
                        {recipe.name}
                    </Typography>
                    <MetaRow recipe={recipe} />
                    <Typography
                        sx={{ fontSize: 17, lineHeight: 1.55, color: TOKENS.inkSoft, mt: 4 }}
                    >
                        {recipe.description}
                    </Typography>

                    {/* The app's own order: description, the cooking CTA, then
                        the macros under their heading. */}
                    <Button
                        variant="contained"
                        href={`/recipes/${recipe.slug}/cook`}
                        className="get start-cooking"
                        startIcon={
                            <Box
                                component="svg"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                sx={{ width: 16, height: 16, fill: "currentColor" }}
                            >
                                <path d="M8 5v14l11-7z" />
                            </Box>
                        }
                    >
                        Start Cooking
                    </Button>

                    {/* "Per serving" is a heading ABOVE the card, which is where
                        `NutrientsSection` puts it — the figures need saying what
                        they are OF before they are read, not after. */}
                    <Typography variant="h2" component="p" sx={{ mt: 6, mb: 2 }}>
                        Per serving
                    </Typography>
                    <Box className="nutrition">
                        {(
                            [
                                ["kcal", "Kcal", recipe.nutrition.kcal, ""],
                                ["carbs", "Carbs", recipe.nutrition.carbs, "g"],
                                ["protein", "Protein", recipe.nutrition.protein, "g"],
                                ["fat", "Fat", recipe.nutrition.fat, "g"],
                            ] as const
                        ).map(([key, label, value, suffix], index) => (
                            <Fragment key={key}>
                                {/* Edge to edge, not a short centred stroke: these
                                    are table rules, and one that stops short of the
                                    box it divides reads as a decoration between two
                                    figures rather than as the line separating two
                                    columns. */}
                                {index > 0 ? <i className="rule" /> : null}
                                <div style={{ color: colours[key] }}>
                                    <b>
                                        {value}
                                        {suffix}
                                    </b>
                                    {/* The label takes the figure's colour, not a
                                        muted grey. That is the app's card, and it is
                                        what makes each column read as one item. */}
                                    <span>{label}</span>
                                </div>
                            </Fragment>
                        ))}
                    </Box>

                </Box>
            </Box>

            <Section title={`Ingredients · serves ${recipe.servings}`}>
                <Paper elevation={1} sx={{ px: { xs: 5, md: 6 }, py: 1 }}>
                    {recipe.ingredients.map((ingredient) => (
                        <div className="ingredient-row" key={ingredient.name}>
                            <Box>
                                <Typography component="span" sx={{ color: TOKENS.inkStrong }}>
                                    {ingredient.name}
                                </Typography>
                                {ingredient.note ? (
                                    <Typography
                                        variant="caption"
                                        sx={{ display: "block", color: TOKENS.inkMuted }}
                                    >
                                        {ingredient.note}
                                    </Typography>
                                ) : null}
                            </Box>
                            <span className="amount">{amount(ingredient)}</span>
                        </div>
                    ))}
                </Paper>
            </Section>

            <Section title="Method" id="method">
                {/* The three figures, on a surface of their own: they are the
                    answer to "how long is my evening", and a card separates them
                    from the axis they summarise rather than letting them read as
                    its first row. */}
                <Paper elevation={1} className="span-summary">
                    {(
                        [
                            ["Start to finish", timeline.totalSeconds],
                            ["Hands on", timeline.activeSeconds],
                            ["Hands off", timeline.waitingSeconds],
                        ] as const
                    ).map(([label, seconds]) => (
                        <div key={label}>
                            <b>{formatSpan(seconds)}</b>
                            <span>{label}</span>
                        </div>
                    ))}
                </Paper>

                <Box className="timeline">
                    {timeline.entries.map((entry) => (
                        // NOT a link, and that is the app's rule rather than an
                        // omission: a row that opened the step made the whole
                        // method a field of tap targets leading away from the
                        // page somebody was reading. Cook is entered
                        // deliberately, from the one button above.
                        <div className="tl-row" key={entry.stepNumber}>
                            <span className="tl-clock">
                                {entry.parallel ? "↳" : formatClockOffset(entry.startsAt)}
                            </span>
                            <span className="tl-rail">
                                <i
                                    className={[
                                        "tl-bar",
                                        entry.seconds === 0 ? "is-empty" : "",
                                        entry.waiting ? "is-waiting" : "",
                                        entry.parallel ? "is-parallel" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ")}
                                    // The bar's LENGTH is the duration, which is
                                    // the whole point of the axis. Capped at the
                                    // rail so an hour of marinating does not push
                                    // the column off the page.
                                    style={{
                                        height: `${Math.max(
                                            4,
                                            Math.min(100, (entry.seconds / longest) * 100)
                                        )}%`,
                                    }}
                                />
                            </span>
                            <div className="tl-body">
                                {entry.parallel ? (
                                    <span className="tl-tag">While that cooks</span>
                                ) : null}
                                <Typography component="h3" className="tl-title">
                                    {entry.title ?? `Step ${entry.stepNumber}`}
                                </Typography>
                                <span className="tl-meta">
                                    Step {entry.stepNumber} ·{" "}
                                    {entry.seconds > 0 ? formatSpan(entry.seconds) : "no timing"}
                                    {entry.waiting ? " · hands off" : ""}
                                </span>
                            </div>
                        </div>
                    ))}
                </Box>

                <Typography variant="caption" className="tl-foot">
                    The full method, with a picture for every step, is on the{" "}
                    <a href={`/recipes/${recipe.slug}/cook`}>cook page</a>.
                </Typography>
            </Section>

            {recipe.tips.length ? (
                <Section title="Tips">
                    <Paper
                        elevation={0}
                        sx={{ background: TOKENS.secondaryContainer, p: { xs: 5, md: 6 } }}
                    >
                        {recipe.tips.map((tip) => (
                            <Typography key={tip} sx={{ lineHeight: 1.6, "& + &": { mt: 3 } }}>
                                {tip}
                            </Typography>
                        ))}
                    </Paper>
                </Section>
            ) : null}

            <Paper elevation={1} sx={{ mt: { xs: 10, md: 14 }, p: { xs: 6, md: 8 }, textAlign: "center" }}>
                <Typography
                    sx={{
                        fontFamily: TOKENS.serif,
                        fontStyle: "italic",
                        fontWeight: 600,
                        fontSize: { xs: 22, md: 26 },
                        color: TOKENS.secondaryInk,
                        mb: 2,
                    }}
                >
                    This is one of {SITE_NAME}&apos;s recipes.
                </Typography>
                <Typography sx={{ color: TOKENS.inkSoft, maxWidth: "48ch", mx: "auto", mb: 5 }}>
                    In the app it cooks itself with you — one step on screen at a time, the
                    amounts for that step only, and the timers already set.
                </Typography>
                <Button variant="contained" href={DOWNLOAD_HREF} className="get">
                    {SITE_NAME} for iPhone
                </Button>
                {/* Provenance, said rather than implied. A reader deserves to know
                    the page is a fixture and how old it is, and it keeps the
                    staleness the fixture's header admits to from being a secret. */}
                <Typography
                    variant="caption"
                    sx={{ display: "block", mt: 5, color: TOKENS.inkMuted }}
                >
                    Captured from the {SITE_NAME} catalogue on {recipe.capturedOn}.
                </Typography>
            </Paper>
        </Container>
    </Box>
    );
};

/**
 * `schema.org/Recipe`, from the same object the page renders.
 *
 * `nutrition` values carry their units because Google reads them as strings and
 * a bare number is ignored; `recipeYield` is the servings count, not a sentence.
 */
function structuredData(recipe: ExampleRecipe, origin?: string): string {
    const data = {
        "@context": "https://schema.org",
        "@type": "Recipe",
        name: recipe.name,
        description: recipe.shortDescription,
        ...(origin ? { image: [`${origin}${recipe.image}`] } : {}),
        recipeCategory: recipe.tags.find((t) => t.type === "course")?.name,
        recipeCuisine: recipe.cuisine,
        recipeYield: `${recipe.servings} servings`,
        totalTime: isoDuration(recipe.totalTimeMinutes),
        keywords: recipe.tags.map((t) => t.name).join(", "),
        author: { "@type": "Organization", name: SITE_NAME },
        nutrition: {
            "@type": "NutritionInformation",
            servingSize: "1 serving",
            calories: `${recipe.nutrition.kcal} kcal`,
            carbohydrateContent: `${recipe.nutrition.carbs} g`,
            proteinContent: `${recipe.nutrition.protein} g`,
            fatContent: `${recipe.nutrition.fat} g`,
        },
        recipeIngredient: recipe.ingredients.map((ingredient) =>
            [amount(ingredient), ingredient.name].filter(Boolean).join(" ")
        ),
        recipeInstructions: recipe.steps.map((step) => ({
            "@type": "HowToStep",
            ...(step.title ? { name: step.title } : {}),
            text: step.text,
        })),
    };

    // `</script>` inside a JSON string would close the tag early; escaping the
    // slash is the standard defence and changes nothing about the parsed JSON.
    return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

export function renderRecipePage(recipe: ExampleRecipe, origin?: string): string {
    return renderPage({
        title: `${recipe.name} — ${SITE_NAME}`,
        description: recipe.shortDescription,
        origin,
        path: `/recipes/${recipe.slug}`,
        styles: RECIPE_STYLES,
        head: structuredData(recipe, origin),
        children: <RecipePage recipe={recipe} />,
    });
}
