import { PROSE_CSS, renderPage, SITE_NAME, SUPPORT_EMAIL } from "./chrome";

/**
 * Privacy policy.
 *
 * Based on the policy previously published on Notion (effective 1 August
 * 2025), extended to describe what the product actually does today: social
 * sign-in through Supabase, AI processing of photos and requests, RevenueCat
 * for subscriptions, and GDPR rights spelled out. The commitments from the
 * original are all preserved — no selling of data, deletion on request,
 * in-app control of kitchen data.
 *
 * DRAFT until reviewed by a human: the effective date below should be set at
 * publication, and German law will additionally want provider identification
 * (Impressum) with a name and address before this goes live on a domain.
 */

const BODY = `
<main class="prose">
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: 9 August 2026</p>

  <p class="lede">${SITE_NAME} turns what's in your fridge into dinner. To do
  that it needs to know about your kitchen — and very little else. This policy
  explains what we collect, why, and what you can do about it.</p>

  <h2>1. Who we are</h2>
  <p>${SITE_NAME} ("we") is the service behind the ${SITE_NAME} iPhone app.
  For anything in this policy, contact us at
  <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>

  <h2>2. What we collect</h2>
  <ul>
    <li><strong>Account.</strong> When you sign in with Apple, Google or
    Facebook, we receive the email address and basic profile your provider
    shares. We never see your passwords for those services.</li>
    <li><strong>Preferences.</strong> What you tell the app about how you cook:
    dietary preferences, skill level, servings, and ingredients you've
    blacklisted.</li>
    <li><strong>Your kitchen.</strong> The ingredients you track, and the
    recipes, favourites, collections, menus and shopping lists you create.</li>
    <li><strong>Fridge photos.</strong> Photos you take are processed to
    recognize the ingredients in them. The recognized ingredients are saved;
    the photos themselves are not kept after processing.</li>
    <li><strong>Subscription status.</strong> Whether you have an active
    subscription, via our subscription provider. Payment itself is handled by
    Apple — we never see your card details.</li>
    <li><strong>Diagnostics.</strong> If the app crashes, we may receive a
    crash report so we can fix it. We may also collect anonymized usage data to
    improve the app.</li>
  </ul>

  <h2>3. How we use it</h2>
  <ul>
    <li>To suggest and generate recipes from what you actually have.</li>
    <li>To keep your kitchen, preferences and library in sync on your account.</li>
    <li>To operate, debug and improve the app.</li>
    <li>To answer you when you contact support.</li>
  </ul>

  <h2>4. AI processing</h2>
  <p>Recipe suggestions, generated recipes, chat and photo recognition are
  powered by AI service providers (currently OpenAI and Google) processing data
  on our behalf. What you submit for these features — a photo, your available
  ingredients, a request — is sent to them to produce the result and is not
  used by us to train AI models.</p>

  <h2>5. Sharing</h2>
  <p>We do not sell your personal information. We share it only:</p>
  <ul>
    <li>with the service providers that run the product for us — hosting and
    database, AI processing, and subscription management — under agreements
    that limit what they may do with it;</li>
    <li>when required by law.</li>
  </ul>

  <h2>6. International transfers</h2>
  <p>Some of our providers process data outside the EEA (for example in the
  United States). Where they do, transfers rely on recognized safeguards such
  as the EU standard contractual clauses.</p>

  <h2>7. Retention and deletion</h2>
  <p>We keep your data while your account exists. You can edit or remove your
  kitchen data in the app at any time, and you can have your account and
  everything stored with it deleted by emailing
  <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> from the address you
  signed in with.</p>

  <h2>8. Your rights</h2>
  <p>Under the GDPR you can ask for access to your data, correction, deletion,
  a portable copy, or restriction of processing, and you can object to
  processing based on our legitimate interests. Write to
  <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> — and you can always
  complain to your local data protection authority.</p>

  <h2>9. Security</h2>
  <p>We use reasonable administrative and technical safeguards to protect your
  information. No transmission or storage is 100% secure, but your data is
  encrypted in transit and access to it is restricted.</p>

  <h2>10. Subscriptions</h2>
  <p>${SITE_NAME} offers auto-renewable subscriptions. Payment is charged to
  your Apple&nbsp;ID at confirmation of purchase, and the subscription renews
  automatically unless cancelled at least 24 hours before the end of the
  current period. You can manage or cancel it in your App Store account
  settings.</p>

  <h2>11. Children</h2>
  <p>${SITE_NAME} is not directed at children under 16, and we do not knowingly
  collect their data.</p>

  <h2>12. Changes</h2>
  <p>When this policy changes, we'll update it here and adjust the date at the
  top. Continued use of the app after a change means the updated policy
  applies.</p>

  <h2>13. Contact</h2>
  <p>Questions, concerns, requests:
  <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>
</main>
`;

export function renderPrivacyPage(origin?: string): string {
    return renderPage({
        title: `Privacy Policy — ${SITE_NAME}`,
        description: `What ${SITE_NAME} collects, why, and the choices you have.`,
        origin,
        path: "/privacy",
        styles: PROSE_CSS,
        body: BODY,
    });
}
