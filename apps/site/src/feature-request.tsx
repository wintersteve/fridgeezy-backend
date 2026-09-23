import { renderPage, SITE_NAME, SUPPORT_EMAIL } from "./chrome";
import { Prose } from "./prose";

/**
 * The page the app's "Feature request" settings row opens.
 *
 * ## Why this is a mail link and not a form
 *
 * The obvious thing to build here is a form. It is the wrong thing, and the
 * reasons are specific rather than a shrug at the effort:
 *
 * - **The site is static on CloudFront.** A form needs somewhere to POST, and
 *   the only server this product has is the API Lambda — where a public,
 *   unauthenticated write endpoint would be a new abuse surface on the same
 *   function that serves paid AI routes, plus CORS, plus rate limiting, plus a
 *   table to hold the rows and something to read them. That is a feature, not a
 *   page.
 * - **A third-party form host contradicts a decision this site has already
 *   made.** `chrome.ts` self-hosts the fonts specifically so visitor IPs do not
 *   reach Google — the LG München reading of GDPR. Posting a name and a message
 *   to a US form SaaS is the same leak, larger, and with content attached.
 * - **The site already answers "contact us" this way, twice.** The support page
 *   leads with the address and the landing page's closing CTA is a `mailto:`.
 *   A third pattern for the same act would be the odd one out.
 * - **There is no App Store listing yet**, so the honest expected volume is a
 *   handful of messages. A form is infrastructure for a problem nobody has.
 *
 * What a form does buy is STRUCTURE — a blank compose window gets "it would be
 * good if it did more stuff". So the link is prefilled: a subject, and a body
 * with the three prompts a useful request answers. That is most of a form's
 * value at none of its cost, and it degrades to an ordinary email if the
 * template is deleted.
 *
 * The honest limitation, stated because it is real: `mailto:` does nothing on a
 * desktop browser with no mail client configured. Hence the address is also
 * printed in full beside the button, so the page still works when the link does
 * not.
 */

/**
 * The prompts a useful request answers, as an email body.
 *
 * Encoded with `encodeURIComponent` rather than hand-escaped: the body carries
 * newlines and an apostrophe, and `&` in a `mailto` query would otherwise start
 * a new parameter. Written as an array so the blank lines between prompts are
 * visible here rather than hidden inside `\n\n`.
 */
const MAIL_BODY = [
    "What I'd like Fridgeezy to do:",
    "",
    "",
    "When I'd use it:",
    "",
    "",
    "Anything else:",
    "",
    "",
].join("\n");

const MAIL_LINK = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `${SITE_NAME} feature request`
)}&body=${encodeURIComponent(MAIL_BODY)}`;

/**
 * One extra rule beyond the shared prose styling: the button. The prose pages
 * have never
 * needed one — support and the legal pages are read, not acted on — so rather
 * than widen the shared stylesheet for a single element, the page brings it.
 * A MUI contained Button is the landing page's primary call to action and is
 * too loud for a reading column, so this is the quieter surface variant. It
 * stays CSS because it lives inside the page's authored markup — see
 * `prose.tsx` for why those bodies are still strings.
 */
const STYLES = `
.btn-mail{
  display:inline-block;margin:4px 0 2px;padding:12px 22px;
  border-radius:var(--r-pill);background:var(--primary);color:var(--on-primary);
  font-weight:600;font-size:15px;letter-spacing:.1px;text-decoration:none;
  box-shadow:var(--shadow-raised);
  transition:transform .15s ease,box-shadow .15s ease;
}
.btn-mail:hover{transform:translateY(-1px);box-shadow:var(--shadow-floating)}
.fallback{font-size:14px;color:var(--ink-muted);margin:12px 0 0}
.fallback a{color:var(--ink-mid)}
`;

const BODY = `
  <h1>Feature requests</h1>
  <p class="lede">${SITE_NAME} is small and still being built. If something's
  missing, tell us — at this size it genuinely changes what gets made next.</p>

  <div class="card">
    <p><a class="btn-mail" href="${MAIL_LINK}">Send a feature request</a></p>
    <p class="fallback">Opens your mail app with a few prompts filled in. If
    that doesn't work, write to
    <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> instead — the prompts
    are just a starting point.</p>
  </div>

  <h2>What makes a request easy to act on</h2>
  <ul>
    <li><strong>The moment, not the mechanism.</strong> "I never know what to
    cook on a Tuesday" tells us more than "add a weekly planner" — the second
    one is your answer, and we'd rather have your question.</li>
    <li><strong>What you do today instead.</strong> The workaround is usually
    the clearest description of the gap.</li>
    <li><strong>One thing at a time.</strong> A list of five gets read as one
    and answered as none.</li>
  </ul>

  <h2>What happens to it</h2>

  <details>
    <summary>Will you build it?</summary>
    <p>Maybe. Everything gets read and nothing gets a promise — a roadmap that
    accepts every request keeps none of them. What we can say is that the app is
    early enough that a good suggestion has an unusually short path to being
    made.</p>
  </details>

  <details>
    <summary>Will I hear back?</summary>
    <p>Usually, and from a person. There is no ticket number and no automated
    reply, so if you need an answer to something specific, say so.</p>
  </details>

  <details>
    <summary>I've found a bug, not a missing feature</summary>
    <p>Same address, and <a href="/support">Support</a> has the details worth
    including — your iPhone model, your iOS version, and the email you signed in
    with. Screenshots help more than descriptions.</p>
  </details>

  <details>
    <summary>Can I see what's already planned?</summary>
    <p>Not yet. There's no public roadmap, partly because publishing one turns
    every plan into a commitment and partly because things still move around
    quickly. The <a href="/">home page</a> is an honest picture of what the app
    does today.</p>
  </details>

  <h2>Privacy</h2>
  <p>A feature request is an email, and it is treated like any other message you
  send us — see the <a href="/privacy">Privacy Policy</a>. Nothing on this page
  collects anything: there is no form, no analytics, and no third party between
  you and the address above.</p>
`;

export function renderFeatureRequestPage(origin?: string): string {
    return renderPage({
        title: `Feature requests — ${SITE_NAME}`,
        description: `Tell us what ${SITE_NAME} should do next. Everything gets read, and the app is early enough that it matters.`,
        origin,
        path: "/feature-request",
        styles: STYLES,
        children: <Prose html={BODY} />,
    });
}
