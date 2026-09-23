import { TOKENS } from "@fridgeezy/design";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { CONTAINER_SX, DOWNLOAD_HREF, renderPage, SITE_NAME } from "./chrome";
import { amount, type ExampleRecipe } from "./recipe";

/**
 * The method, on a screen of its own — the web's answer to cook mode.
 *
 * ## Why this is a PAGE and not a drawer on the recipe
 *
 * Three reasons, and the first is the app's:
 *
 *  - **Cook is somewhere you GO.** `RecipeTimeline`'s rows are deliberately not
 *    pressable — its own comment records that making them open a step "made the
 *    whole method a field of tap targets leading away from the page someone was
 *    reading", and that cook is entered deliberately, from one control. This
 *    page is that control's destination.
 *  - **A drawer on a static site is not a screen.** With no runtime JavaScript
 *    the options are a `<details>`, which is a hidden block rather than a
 *    place, or shipping a framework to animate a panel — which is exactly what
 *    `chrome.tsx` argues against for the sake of three interactions.
 *  - **A page is linkable and indexable.** The eleven steps and their artwork
 *    become crawlable content at a URL somebody can send; a drawer's contents
 *    are neither.
 *
 * The recipe page keeps the TIMELINE instead, which is the thing a step list
 * cannot tell you — when to start if you want to eat at eight, and how much of
 * the evening is hands-off.
 *
 * ## The mise en place is first, and it is the ingredients
 *
 * Cook mode opens on everything measured out before step one, because that is
 * how the dish is actually cooked; repeating the amounts at the top here is the
 * same idea, and it saves the reader going back to the other page mid-step.
 */

/** "25 min", "1 hr 5 min" — spans read as words, as the step meta sets them. */
function formatMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    if (!hours) return `${rest} min`;

    return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

const STYLES = `
.cook-head{padding:24px 0 8px;max-width:60ch}
.cook-back{
  display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;
  font-size:13px;font-weight:600;color:var(--primary-ink);text-decoration:none;
}
.cook-back:hover{text-decoration:underline}

/* One step, two columns: the picture, then the step. Stacked on a phone and
   side by side from 760 — the image is the wider of the two at the sizes that
   matter, so it takes the fixed column and the prose takes what is left rather
   than the other way round. A start alignment is used so a short step does not
   stretch its text down the side of a tall picture. */
.cook-step{padding:28px 0;border-top:1px solid var(--outline)}
.cook-step:first-of-type{border-top:0}
@media (min-width: 760px){
  /* EXACTLY two cells — the picture and everything else. The step's head, its
     prose and its meta are wrapped in a cook-body wrapper for that reason: as loose
     children they were four grid items and landed in alternating columns, with
     the heading beside the picture and the text underneath it. */
  .cook-step{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:32px;align-items:start}
  .cook-step .cook-art{margin:0}
}
.cook-step-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.cook-num{
  flex:none;width:34px;height:34px;border-radius:var(--r-pill);
  display:flex;align-items:center;justify-content:center;
  background:var(--primary-container);color:var(--primary-ink);
  font-weight:700;font-size:15px;
}
.cook-step h2{
  font-family:var(--serif);font-size:22px;line-height:28px;color:var(--ink-strong);
}
.cook-step p{font-size:17px;line-height:1.6;max-width:56ch}

/* Full width here, where the recipe page capped them: this is the screen the
   pictures are FOR, and a step's artwork is what tells a cook the coating is
   meant to look that shaggy. */
/* No cap of its own: stacked it fills the column, and side by side the grid
   track is what holds it to 340. A max-width here left it ten points narrower
   than the text under it on a phone, which reads as a misalignment rather than
   as a decision. */
.cook-art{
  width:100%;margin:16px 0 0;
  /* The recipe page's hero treatment exactly — xxl corners and the floating
     shadow. Every painting on the site is lifted the same way, so a step's is
     recognisably the same kind of object as the dish's rather than a smaller,
     flatter one. Change one and change the other. */
  border-radius:var(--r-xxl);box-shadow:var(--shadow-floating);
}
.cook-meta{
  display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:14px;
  font-size:11px;font-weight:600;letter-spacing:.5px;
  text-transform:uppercase;color:var(--ink-muted);
}
.mise{background:var(--bg-variant);border-radius:var(--r-xl);padding:20px 22px;margin-top:8px}
.mise ul{margin:8px 0 0;padding:0;list-style:none;columns:2;column-gap:40px}
.mise li{
  break-inside:avoid;padding:5px 0;font-size:14px;line-height:20px;
  border-bottom:1px solid var(--outline);
}
.mise li b{font-weight:600;color:var(--ink-strong)}
@media (min-width: 900px){.mise ul{columns:3}}
@media (max-width: 600px){.mise ul{columns:1}}
`;

const CookPage = ({ recipe }: { recipe: ExampleRecipe }) => (
    <Box component="main">
        <Container maxWidth="lg" disableGutters className="container" sx={CONTAINER_SX}>
            <Box className="cook-head">
                <a className="cook-back" href={`/recipes/${recipe.slug}`}>
                    ← {recipe.name}
                </a>
                <Typography variant="h2" component="p" sx={{ mb: 1.5 }}>
                    Method · {recipe.steps.length} steps
                </Typography>
                <Typography
                    variant="h1"
                    sx={{ fontFamily: TOKENS.serif, fontSize: { xs: 30, md: 38 }, lineHeight: 1.15 }}
                >
                    Cooking {recipe.name}
                </Typography>
            </Box>

            <Box className="mise">
                <Typography variant="h2" component="p">
                    Mise en place · serves {recipe.servings}
                </Typography>
                <ul>
                    {recipe.ingredients.map((ingredient) => (
                        <li key={ingredient.name}>
                            <b>{ingredient.name}</b>
                            {amount(ingredient) ? ` — ${amount(ingredient)}` : ""}
                        </li>
                    ))}
                </ul>
            </Box>

            <Box sx={{ mt: 6 }}>
                {recipe.steps.map((step, index) => (
                    <Box component="section" className="cook-step" key={step.number}>
                        {step.image ? (
                            <img
                                className="cook-art"
                                src={step.image}
                                alt=""
                                width="1200"
                                height="896"
                                // The first is above the fold on a phone; the
                                // rest are fetched as they are scrolled to.
                                {...(index === 0
                                    ? { fetchPriority: "high" as const }
                                    : { loading: "lazy" as const })}
                                decoding="async"
                            />
                        ) : null}
                        <div className="cook-body">
                            <div className="cook-step-head">
                                <span className="cook-num">{step.number}</span>
                                <Typography component="h2">
                                    {step.title ?? `Step ${step.number}`}
                                </Typography>
                            </div>
                            <Typography>{step.text}</Typography>
                            {step.durationSeconds || step.temperatureC || step.equipment?.length ? (
                                <div className="cook-meta">
                                    {step.durationSeconds ? (
                                        <span>
                                            {formatMinutes(Math.round(step.durationSeconds / 60))}
                                        </span>
                                    ) : null}
                                    {step.temperatureC ? <span>{step.temperatureC}°C</span> : null}
                                    {step.equipment?.length ? (
                                        <span>{step.equipment.join(" · ")}</span>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    </Box>
                ))}
            </Box>

            <Paper elevation={1} sx={{ mt: 10, p: { xs: 6, md: 8 }, textAlign: "center" }}>
                <Typography
                    sx={{
                        fontFamily: TOKENS.serif,
                        fontStyle: "italic",
                        fontWeight: 600,
                        fontSize: { xs: 21, md: 25 },
                        color: TOKENS.secondaryInk,
                        mb: 2,
                    }}
                >
                    Cooking it on a phone is easier.
                </Typography>
                <Typography sx={{ color: TOKENS.inkSoft, maxWidth: "46ch", mx: "auto", mb: 5 }}>
                    In the app this is one step at a time, with only that step&apos;s amounts on
                    screen and the timers already set — so you are not scrolling with your hands
                    covered in breadcrumbs.
                </Typography>
                <Button variant="contained" href={DOWNLOAD_HREF} className="get">
                    {SITE_NAME} for iPhone
                </Button>
            </Paper>
        </Container>
    </Box>
);

export function renderCookPage(recipe: ExampleRecipe, origin?: string): string {
    return renderPage({
        title: `How to cook ${recipe.name} — ${SITE_NAME}`,
        description: `The full method for ${recipe.name}, step by step, with a picture for every stage.`,
        origin,
        path: `/recipes/${recipe.slug}/cook`,
        styles: STYLES,
        children: <CookPage recipe={recipe} />,
    });
}
