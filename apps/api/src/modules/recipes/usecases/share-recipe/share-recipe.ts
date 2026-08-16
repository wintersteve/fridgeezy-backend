import { Request, Response } from "express";

import { fetchRecipeSummary } from "../../services";

/**
 * The app's custom scheme, from `app.json`. A link into the app for anyone who
 * already has it; everyone else gets the page itself.
 */
const APP_SCHEME = "fridgeezy";

/**
 * Escapes a value for interpolation into HTML — both text nodes and quoted
 * attributes.
 *
 * Not optional politeness: recipe names are model-written and routinely contain
 * apostrophes and ampersands ("Bee's Knees", "Salt & Pepper Squid"). An
 * unescaped `"` inside an `og:title` attribute ends the attribute early and the
 * crawler reads a truncated title; an unescaped `<` lets a name inject markup
 * into a page we serve.
 */
const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

const page = ({
    title,
    description,
    image,
    deepLink,
}: {
    title: string;
    description: string;
    image?: string | null;
    deepLink: string;
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>

<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}

<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 3rem;
    font-family: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
    background: #fdfbf9; color: #5c5450;
    display: flex; flex-direction: column; align-items: center; gap: 1.25rem;
  }
  .card {
    width: 100%; max-width: 420px; background: #fff; border-radius: 20px;
    overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,.06);
  }
  .card img { width: 100%; display: block; aspect-ratio: 3 / 4; object-fit: cover; }
  .body { padding: 1.25rem 1.4rem 1.5rem; }
  h1 { margin: 0 0 .4rem; font-size: 1.4rem; line-height: 1.2; color: #3f3936; }
  p { margin: 0; font-size: .95rem; line-height: 1.5; }
  .cta {
    display: block; max-width: 420px; width: 100%; box-sizing: border-box;
    margin-top: .25rem; padding: .9rem 1rem; border-radius: 999px;
    background: #f4a67a; color: #fff; font-weight: 600; text-align: center;
    text-decoration: none;
  }
  .note { font-size: .8rem; color: #9a938f; }
</style>
</head>
<body>
  <div class="card">
    ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(title)}">` : ""}
    <div class="body">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
    </div>
  </div>
  <a class="cta" href="${escapeHtml(deepLink)}">Open in Fridgeezy</a>
  <span class="note">Fridgeezy turns what's in your fridge into dinner.</span>
</body>
</html>`;

/**
 * A shareable page for one recipe.
 *
 * Exists because a link preview is built by the *receiving* app — iMessage,
 * WhatsApp, Slack fetch the URL and read its Open Graph tags. They cannot fetch
 * a `fridgeezy://` link, and a bare image URL yields a picture with no title or
 * description. So sharing a recipe richly requires an HTML page, which is all
 * this is.
 *
 * Deliberately server-rendered with no client JS: a crawler takes the first
 * response and never runs scripts, so anything added after load is invisible to
 * the preview.
 *
 * The "Open in Fridgeezy" button is a plain link rather than an automatic
 * redirect. Redirecting on load fires for crawlers and for people who do not
 * have the app, and a failed scheme navigation shows a browser error dialog —
 * a worse first impression than a page that simply offers the button.
 *
 * Tapping the https link itself does NOT open the app: that needs universal
 * links, which need a domain we control. Deferred deliberately — see "Deferred
 * — universal links for recipe sharing" in the client repo's TODOS.md for the
 * full list of what it takes.
 */
export async function shareRecipe(req: Request, res: Response) {
    const { recipeId } = req.params;

    const summary = await fetchRecipeSummary(recipeId);

    // An OWNED recipe is not shareable through this route, and the reason is the
    // same one that makes the route open in the first place: its caller is not
    // the app. iMessage, Slack and the tapper's browser hold no Supabase
    // session, so there is nobody here to compare `created_by` against — the
    // choice is "everyone" or "no one", and for a page somebody photographed out
    // of their own cookbook it is no one.
    //
    // Answered as the SAME 404 a missing recipe gets, deliberately: a distinct
    // status would tell an unauthenticated stranger that a given id exists and
    // is private, which is more than they could learn from the recipe tables
    // themselves now that RLS is on.
    //
    // Note this is a product decision, not a technical limit. Sharing an import
    // is buildable — a signed, expiring share token minted by the owner through
    // an authenticated route — and that is what to build if it is wanted. Do not
    // "fix" it by opening the read.
    if (!summary || summary.createdBy) {
        res.status(404)
            .type("html")
            .send(
                page({
                    title: "Recipe not found",
                    description:
                        "This recipe isn't available any more — it may have been deleted.",
                    deepLink: `${APP_SCHEME}://`,
                })
            );
        return;
    }

    // The card gloss where there is one: `description` is the detail-screen
    // paragraph and gets clipped mid-sentence in a preview.
    const description =
        summary.shortDescription?.trim() || summary.description?.trim() || "";

    res
        // Previews are fetched by many crawlers and re-fetched on every reshare,
        // and a recipe's name and image effectively never change once written.
        .set("Cache-Control", "public, max-age=3600")
        .type("html")
        .send(
            page({
                title: summary.name,
                description,
                image: summary.image,
                deepLink: `${APP_SCHEME}://recipes/${summary.id}`,
            })
        );
}
