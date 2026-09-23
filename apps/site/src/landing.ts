import {
    APP_STORE_URL,
    APPLE_GLYPH,
    DOWNLOAD_HREF,
    renderPage,
    SITE_NAME,
    SUPPORT_EMAIL,
} from "./chrome";

/**
 * The landing page.
 *
 * Written MOBILE-FIRST, which is the whole shape of the 2026-09-23 rewrite. The
 * page it replaces was a desktop layout with six `max-width` breakpoints
 * unpicking it: the product tour was a two-column grid of a tab rail beside one
 * phone, and on a phone that grid collapsed to a stack whose auto-advancing
 * rail was a list of paragraphs with a thin progress bar. Everything here is a
 * phone layout first, with `min-width` queries that only ever widen it — and
 * the two multi-screen sections are **swipeable rails**, which is both the
 * native gesture and the app's own idiom (`RecipeCards`, the community rail).
 *
 * Three deliberate echoes of the app, because the page's job is to look like
 * the product it advertises:
 *
 * - The hero is the app's welcome screen writ large: the same "Cook something"
 *   headline with the same four rotating claims in Lora semibold italic
 *   (`HEADLINE_WORDS` in the client's welcome screen) and the same staggered
 *   fade-up entrance.
 *
 * - The tour's eyebrows are cook mode's ("STEP 1 · YOUR FRIDGE"), and the
 *   numbering is honest: the five steps are the product's actual loop.
 *
 * - The menu section is drawn on the sage wash the app reserves for the same
 *   feature, because composing a menu is the one thing here nothing else does
 *   and it had no section of its own before this.
 *
 * The screenshots are real captures of the running app, one per screen, LIGHT
 * ONLY — see `chrome.ts` for why the dark set is gone.
 *
 * Everything that moves is behind prefers-reduced-motion: no-preference, and
 * nothing that moves carries information: the reveal animation is an entrance
 * and the cycling word is also spelled out in an `aria-label`.
 *
 * There is ONE fixed element on the page, the nav, and a second one is not
 * wanted. A download dock pinned to the foot shipped for a few hours and was
 * removed: on a phone it stacked against the sticky header and ate a band top
 * and bottom of a screen that is mostly a picture of a phone, to re-offer a
 * control that is already in the nav two centimetres above it.
 */

/** The welcome screen's rotating claims, verbatim. */
const WORDS = ["with leftovers.", "tonight.", "waste-free.", "delicious."];

interface TourStep {
    /** Asset basename under /assets/screens. */
    screen: string;
    eyebrow: string;
    title: string;
    copy: string;
}

const TOUR: TourStep[] = [
    {
        screen: "home",
        eyebrow: "Step 1 · Your fridge",
        title: "Start with what you've got",
        copy: "Photograph the shelf or type a few things in. Every ingredient is recognised, and remembered for next time.",
    },
    {
        screen: "browse",
        eyebrow: "Step 2 · Ideas",
        title: "Find something worth cooking",
        copy: "Browse by cuisine, course, effort or diet — and every plate is painted by hand, not stock photography.",
    },
    {
        screen: "recipe",
        eyebrow: "Step 3 · The dish",
        title: "A recipe, not an essay",
        copy: "Amounts scaled to your table, nutrition per serving, and the effort stated before you commit to it.",
    },
    {
        screen: "cook",
        eyebrow: "Step 4 · Cook mode",
        title: "One step at a time",
        copy: "Just this step's ingredients, marked inside the sentence, with the timer already set for you.",
    },
    {
        screen: "chat",
        eyebrow: "Step 5 · Ask",
        title: "Argue with the recipe",
        copy: "Make it milder, quicker, vegan or a step fancier — and it rewrites the dish rather than lecturing you.",
    },
];

interface MenuSlide {
    screen: string;
    title: string;
    copy: string;
}

/**
 * The menu feature, in the order it is met: somebody else's dinner, your own
 * menu, then the thing that makes a menu cookable at all.
 */
const MENU_SLIDES: MenuSlide[] = [
    {
        screen: "menus",
        title: "Dinners people served",
        copy: "Start from a menu someone has already cooked — or pick a main and have the rest built around it.",
    },
    {
        screen: "meal",
        title: "Courses that belong together",
        copy: "Paired from dishes actually served with your main. Never a filter that matched on cuisine and called it a meal.",
    },
    {
        screen: "runsheet",
        title: "One clock, every course",
        copy: "A single run sheet interleaves the steps, names the holds, and catches an oven clash before it happens.",
    },
];

interface ExtraCard {
    wash: string;
    ink: string;
    icon: string;
    title: string;
    copy: string;
}

const EXTRAS: ExtraCard[] = [
    {
        wash: "var(--rose-container)",
        ink: "var(--rose-ink)",
        icon: `<path d="M7 8h10M14 5l3 3-3 3M17 16H7M10 13l-3 3 3 3"/>`,
        title: "Missing one thing?",
        copy: "Substitutes worked out for the dish you're making, with the ratio to use.",
    },
    {
        wash: "var(--secondary-container)",
        ink: "var(--secondary-ink)",
        icon: `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2"/>`,
        title: "Lists that write themselves",
        copy: "Everything you're short of, merged across dishes and sorted by aisle.",
    },
    {
        wash: "var(--primary-container)",
        ink: "var(--primary-ink)",
        icon: `<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18" stroke-linecap="round"/>`,
        title: "Plan the week",
        copy: "Put dinners on the nights you'll cook them and get one shop for all of it.",
    },
    {
        wash: "var(--tertiary-container)",
        ink: "var(--tertiary-ink)",
        icon: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6" stroke-linecap="round"/>`,
        title: "Timers that follow you",
        copy: "Every timer on the lock screen, so a pan isn't lost to a phone call.",
    },
];

const STYLES = `
/* ---------- shared section furniture ---------- */
.sec{padding:56px 0 0}
.sec-head{max-width:34ch}
.sec-head .eyebrow{margin-bottom:10px}
.sec-head h2{
  font-weight:700;font-size:clamp(26px,6.4vw,34px);line-height:1.2;
  letter-spacing:-.3px;color:var(--ink-strong);
  /* These headings are two or three words from wrapping at almost every width,
     and the default greedy break leaves the last word alone on its own line —
     "Little helpers, on / hand". Balancing splits them evenly instead, and the
     widths it picks change with the reader's text size, which a hand-placed
     non-breaking space cannot. Ignored by anything that does not support it,
     which is the greedy break we would otherwise have had. */
  text-wrap:balance;
}
.sec-head .lede{
  margin-top:12px;font-size:16px;line-height:1.55;color:var(--ink-soft);
  text-wrap:pretty;
}
@media (min-width: 720px){
  .sec{padding:88px 0 0}
  .sec-head .lede{font-size:17px}
}

/* ---------- the phone ---------- */
/* 1206x2622 is the capture size; the frame's padding and radii are scaled off
   the rendered width so one rule serves the 300px hero and the 210px rail. */
.phone{
  position:relative;width:100%;
  aspect-ratio:1206/2622;
  border-radius:15.6%/7.2%;
  background:#1B1917;padding:3%;
  box-shadow:var(--shadow-floating),0 26px 52px rgba(6,6,6,.13);
}
.phone img{
  width:100%;height:100%;object-fit:cover;object-position:top center;
  border-radius:12.6%/5.8%;background:var(--bg-variant);
}

/* ---------- hero ---------- */
/* The clip is HERE and not only on body, and that is the whole of the
   horizontal-overflow fix. The washes below are deliberately wider than the
   screen, and "body{overflow-x:clip}" does not contain them: overflow set on
   body PROPAGATES to the viewport rather than clipping the element, so the
   document stayed 507px wide inside a 390px phone and panned sideways.
   On an ordinary element there is no propagation rule and the clip just
   clips — measured 2026-09-23, scrollWidth 507 -> 390. It has to be
   "overflow-x:clip" rather than "hidden": hidden would coerce the y axis to
   auto and make the hero its own scroll container, cutting the phone's
   shadow off at the section edge. */
.hero{position:relative;padding:36px 0 8px;overflow-x:clip}
.hero .container{position:relative;z-index:1}
.hero h1{
  /* The floor is 30 rather than something heroic: this line must not wrap and
     must not overflow, and below ~372px the clamp's minimum is what is drawn —
     at 38px "Cook something" is 312px wide against a 280px column on a 320px
     phone. Everything above that width is the vw term, which cannot overflow. */
  font-weight:700;font-size:clamp(30px,10.2vw,60px);line-height:1.1;
  letter-spacing:-.6px;color:var(--ink-strong);
}
.hero .cycle{
  display:inline-grid;
  font-family:'Lora',Georgia,serif;font-style:italic;font-weight:600;
  color:var(--secondary-ink);
}
.hero .cycle span{grid-area:1/1;opacity:0;animation:cycle-word 10s infinite;justify-self:start}
/* The resting state is the FIRST word, not four words stacked on each other.
   Every span shares one grid cell, so anything that stops the animation
   running — a reduced-motion setting, a browser that never starts it — draws
   all four on top of one another unless one of them is opaque by default. */
.hero .cycle span:first-child{opacity:1}
.hero .cycle span:nth-child(1){animation-delay:0s}
.hero .cycle span:nth-child(2){animation-delay:2.5s}
.hero .cycle span:nth-child(3){animation-delay:5s}
.hero .cycle span:nth-child(4){animation-delay:7.5s}
@keyframes cycle-word{
  0%{opacity:0;transform:translateY(14px)}
  4%,22%{opacity:1;transform:translateY(0)}
  26%,100%{opacity:0;transform:translateY(-10px)}
}
.hero .sub{
  max-width:40ch;margin-top:18px;text-wrap:pretty;
  font-size:17px;line-height:1.55;color:var(--ink-soft);
}
.hero .cta-row{display:flex;flex-direction:column;align-items:flex-start;gap:12px;margin-top:26px}
.hero .hero-art{margin-top:38px;display:flex;justify-content:center}
.hero .hero-art .phone{width:min(272px,70vw)}

/* The washes sit behind everything and are clipped by the body's overflow.
   Sized off the viewport so they stay the same gesture on a phone and a
   desktop rather than becoming a pair of dots. */
.hero .wash{position:absolute;border-radius:50%;z-index:0;pointer-events:none}
.hero .wash.sage{
  background:radial-gradient(circle,var(--secondary-container) 0%,transparent 70%);
  width:min(760px,150vw);height:min(760px,150vw);
  right:-30vw;top:-8vh;
}
.hero .wash.peach{
  background:radial-gradient(circle,var(--primary-container) 0%,transparent 70%);
  width:min(560px,110vw);height:min(560px,110vw);
  left:-26vw;top:34vh;
}

@media (min-width: 900px){
  .hero{padding:64px 0 0}
  .hero .container{
    display:grid;grid-template-columns:minmax(0,1fr) minmax(0,380px);
    gap:48px;align-items:center;
  }
  .hero .sub{font-size:19px}
  .hero .cta-row{flex-direction:row;align-items:center;gap:18px}
  .hero .hero-art{margin-top:0}
  .hero .hero-art .phone{width:300px}
  .hero .wash.sage{right:-14vw;top:-14vh}
}

/* ---------- download controls ---------- */
.get{
  display:inline-flex;align-items:center;gap:11px;
  padding:15px 26px;border-radius:var(--r-pill);
  text-decoration:none;font-weight:700;font-size:16px;letter-spacing:.1px;
  background:var(--primary);color:var(--on-primary);
  box-shadow:var(--shadow-raised);
  position:relative;
  transition:transform .15s ease,box-shadow .15s ease;
}
.get:hover{transform:translateY(-1px);box-shadow:var(--shadow-floating)}
.get svg{width:20px;height:20px;fill:currentColor;flex:none}
.get .stack{display:flex;flex-direction:column;line-height:1.15;text-align:left}
.get .stack small{font-size:11px;font-weight:500;letter-spacing:.4px;opacity:.86}
/* The halo only ever plays on a control that leads somewhere. A pulse on a
   plate nobody can press is an animation advertising a dead end. */
@media (prefers-reduced-motion: no-preference){
  .get::after{
    content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
    animation:halo 3s cubic-bezier(.22,.61,.36,1) infinite;
  }
  @keyframes halo{
    0%{box-shadow:0 0 0 0 rgba(244,166,122,.5)}
    70%{box-shadow:0 0 0 16px rgba(244,166,122,0)}
    100%{box-shadow:0 0 0 0 rgba(244,166,122,0)}
  }
}
.get-note{
  display:inline-flex;align-items:center;gap:7px;
  font-size:13px;font-weight:500;color:var(--ink-mid);
}
.get-note svg{width:14px;height:14px;fill:currentColor}
.ghost{
  font-size:15px;font-weight:600;color:var(--primary-ink);text-decoration:none;
  display:inline-flex;align-items:center;gap:6px;
}
.ghost::after{content:"→";transition:transform .2s ease}
.ghost:hover::after{transform:translateX(3px)}

/* ---------- rails ---------- */
/* Edge-to-edge on a phone with the gutter restored as scroll padding, so the
   first card lines up with the heading above it and the last one can still be
   snapped to. "scrollbar-width:none" because the snap points and the peeking
   next card are the affordance. */
.rail{
  display:flex;gap:14px;
  margin:28px calc(var(--gutter) * -1) 0;
  padding:4px var(--gutter) 12px;
  overflow-x:auto;overscroll-behavior-x:contain;
  scroll-snap-type:x mandatory;scroll-padding-inline:var(--gutter);
  scrollbar-width:none;
}
.rail::-webkit-scrollbar{display:none}
.rail > *{flex:none;width:min(230px,66vw);scroll-snap-align:start}
.rail-card h3{
  font-weight:600;font-size:16px;line-height:22px;letter-spacing:.1px;
  color:var(--ink-strong);margin:14px 0 4px;text-wrap:balance;
}
.rail-card .eyebrow{margin-top:14px}
.rail-card .eyebrow + h3{margin-top:5px}
.rail-card p{font-size:14px;line-height:20px;letter-spacing:.25px;color:var(--ink-soft)}

/* Once every card fits, the rail stops being a rail — a row with no overflow
   still showing snap points reads as broken on a trackpad. */
@media (min-width: 1000px){
  .tour-rail{
    display:grid;grid-template-columns:repeat(5,1fr);gap:20px;
    margin-inline:0;padding-inline:0;overflow:visible;
  }
  .tour-rail > *{width:auto}
}
@media (min-width: 760px){
  .menu-rail{
    display:grid;grid-template-columns:repeat(3,1fr);gap:24px;
    margin-inline:0;padding-inline:0;overflow:visible;
  }
  .menu-rail > *{width:auto}
  .menu-rail .rail-card h3{font-size:17px;margin-top:18px}
}

/* ---------- the menu section ---------- */
/* Its own ground, because this is the one capability with no equivalent
   anywhere else and it had no section at all before. */
.menus{margin-top:64px;padding:48px 0 56px;background:var(--secondary-container)}
.menus .sec-head h2{max-width:14ch}
.menus .foot{
  margin-top:22px;font-size:14px;line-height:20px;color:var(--secondary-ink);
  font-weight:500;
}
.menus .rail-card p{color:var(--ink)}
@media (min-width: 720px){.menus{margin-top:96px;padding:72px 0 80px}}

/* ---------- extras ---------- */
.extras .grid{display:grid;grid-template-columns:1fr;gap:14px;margin-top:28px}
.extras .card{border-radius:var(--r-xxl);padding:24px 22px 26px}
.extras .card svg{
  width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:1.8;
  stroke-linejoin:round;margin-bottom:14px;
}
.extras .card h3{font-weight:600;font-size:17px;line-height:24px;margin-bottom:5px}
.extras .card p{font-size:14px;line-height:20px;letter-spacing:.25px;color:var(--ink)}
@media (min-width: 620px){.extras .grid{grid-template-columns:repeat(2,1fr);gap:18px}}
@media (min-width: 1000px){.extras .grid{grid-template-columns:repeat(4,1fr)}}

/* ---------- closing ---------- */
.closing{padding:64px 0 0}
.closing .band{
  background:var(--surface);border:1px solid var(--outline);
  border-radius:var(--r-xxl);box-shadow:var(--shadow-rest);
  padding:44px 24px 46px;text-align:center;
}
.closing .line{
  font-family:'Lora',Georgia,serif;font-style:italic;font-weight:600;
  font-size:clamp(25px,6.4vw,36px);line-height:1.28;color:var(--secondary-ink);
  margin-bottom:26px;
}
.closing .cta-row{display:flex;flex-direction:column;align-items:center;gap:14px}
.closing .fine{margin-top:22px;font-size:12px;letter-spacing:.5px;color:var(--ink-muted)}
@media (min-width: 720px){.closing .band{padding:64px 40px 66px}}

/* ---------- motion ---------- */
@media (prefers-reduced-motion: no-preference){
  .rise{opacity:0;animation:rise .65s cubic-bezier(.22,.61,.36,1) forwards}
  .rise-1{animation-delay:.06s}.rise-2{animation-delay:.16s}
  .rise-3{animation-delay:.26s}.rise-4{animation-delay:.36s}.rise-5{animation-delay:.5s}
  @keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}

  /* Scroll entrance. ".js" gates it so a reader with no JavaScript sees the
     page rather than a column of invisible sections. */
  .js .reveal{
    opacity:0;transform:translateY(22px);
    transition:opacity .7s cubic-bezier(.22,.61,.36,1),transform .7s cubic-bezier(.22,.61,.36,1);
    transition-delay:calc(var(--i,0) * 80ms);
  }
  .js .reveal.in{opacity:1;transform:none}
}
@media (prefers-reduced-motion: reduce){
  html{scroll-behavior:auto}
  .hero .cycle span{animation:none}
  .hero .cycle span:nth-child(n+2){display:none}
  .hero .cycle span:nth-child(1){opacity:1}
}
`;

const SCRIPT = `
document.documentElement.classList.add('js');
(function(){
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Entrances. Each group's children get an index so a row of cards arrives as
     a sweep rather than all at once; one observer for the whole page.

     The bottom margin is 60 PIXELS and not a percentage. A percentage is a
     share of the viewport, so on a tall one it carves out a dead band at the
     foot that some element can never be scrolled past — which is exactly what
     swallowed the closing band, the last thing on the page, in a full-height
     render. A fixed inset fires for anything that can be scrolled to at all. */
  var targets=[].slice.call(document.querySelectorAll('.reveal'));
  if(!still&&'IntersectionObserver' in window){
    var io=new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(!e.isIntersecting)return;
        e.target.classList.add('in');
        io.unobserve(e.target);
      });
    },{rootMargin:'0px 0px -60px 0px',threshold:0});
    targets.forEach(function(el){io.observe(el)});
  } else {
    targets.forEach(function(el){el.classList.add('in')});
  }

})();
`;

/**
 * The download control, at three sizes. Until there is a listing it is an
 * invitation rather than a link to a 404 — the page's one action has to go
 * somewhere, and email is the channel the support and feature-request pages
 * already use.
 */
function renderGet(): string {
    const [over, under] = APP_STORE_URL
        ? ["Download on the", "App Store"]
        : ["Coming to the App Store", "Get an early invite"];

    return `<a class="get" href="${DOWNLOAD_HREF}">${APPLE_GLYPH}
      <span class="stack"><small>${over}</small>${under}</span>
    </a>`;
}

function renderTourStep(step: TourStep, index: number): string {
    return `<div class="rail-card reveal" style="--i:${index}">
  <div class="phone">
    <img src="/assets/screens/${step.screen}.webp" alt="${step.title} — the ${SITE_NAME} app"
      width="780" height="1696" ${index < 2 ? "" : 'loading="lazy" '}decoding="async">
  </div>
  <span class="eyebrow">${step.eyebrow}</span>
  <h3>${step.title}</h3>
  <p>${step.copy}</p>
</div>`;
}

function renderMenuSlide(slide: MenuSlide, index: number): string {
    return `<div class="rail-card reveal" style="--i:${index}">
  <div class="phone">
    <img src="/assets/screens/${slide.screen}.webp" alt="${slide.title} — the ${SITE_NAME} app"
      width="780" height="1696" loading="lazy" decoding="async">
  </div>
  <h3>${slide.title}</h3>
  <p>${slide.copy}</p>
</div>`;
}

function renderExtra(card: ExtraCard, index: number): string {
    return `<div class="card reveal" style="background:${card.wash};--i:${index}">
  <svg viewBox="0 0 24 24" aria-hidden="true" style="color:${card.ink}">${card.icon}</svg>
  <h3 style="color:${card.ink}">${card.title}</h3>
  <p>${card.copy}</p>
</div>`;
}

const BODY = `
<main>
  <section class="hero">
    <span class="wash sage" aria-hidden="true"></span>
    <span class="wash peach" aria-hidden="true"></span>
    <div class="container">
      <div class="hero-copy">
        <h1>
          <span class="rise rise-1" style="display:block">Cook something</span>
          <span class="cycle rise rise-2" aria-label="${WORDS.join(" ")}">
            ${WORDS.map((word) => `<span>${word}</span>`).join("\n            ")}
          </span>
        </h1>
        <p class="sub rise rise-3">Tell Fridgeezy what's in your fridge. It finds tonight's
        dinner, writes the recipe, and cooks it with you — one step at a time.</p>
        <div class="cta-row rise rise-4">
          ${renderGet()}
          <a class="ghost" href="#tour">See how it works</a>
        </div>
      </div>
      <div class="hero-art rise rise-5">
        <div class="phone">
          <img src="/assets/screens/home.webp" alt="The ${SITE_NAME} home screen"
            width="780" height="1696" fetchpriority="high" decoding="async">
        </div>
      </div>
    </div>
  </section>

  <section class="sec" id="tour">
    <div class="container">
      <div class="sec-head reveal">
        <p class="eyebrow">How it works</p>
        <h2>Fridge to plate, in five steps</h2>
        <p class="lede">No meal-kit box, no ten-paragraph story about somebody's
        grandmother. Just the food you already own, turned into dinner.</p>
      </div>
      <div class="rail tour-rail">
        ${TOUR.map(renderTourStep).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="menus">
    <div class="container">
      <div class="sec-head reveal">
        <p class="eyebrow">The part nobody else does</p>
        <h2>One dish. A whole menu.</h2>
        <p class="lede">Pick the main you want and Fridgeezy builds the evening
        around it — a starter, a side, something sweet — then puts every course
        on one clock so they land together.</p>
      </div>
      <div class="rail menu-rail">
        ${MENU_SLIDES.map(renderMenuSlide).join("\n        ")}
      </div>
      <p class="foot reveal">And one shopping list for all of it, merged across
      the courses and sorted by aisle.</p>
    </div>
  </section>

  <section class="sec extras">
    <div class="container">
      <div class="sec-head reveal">
        <p class="eyebrow">And when you need it</p>
        <h2>Little helpers, on hand</h2>
      </div>
      <div class="grid">
        ${EXTRAS.map(renderExtra).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="closing">
    <div class="container">
      <div class="band reveal">
        <p class="line">Cook something delicious, tonight.</p>
        <div class="cta-row">
          ${renderGet()}
          <span class="get-note">${APPLE_GLYPH}${
              APP_STORE_URL
                  ? "Free to browse. iPhone, iOS 16 and up."
                  : `${SITE_NAME} is coming to the App Store.`
          }</span>
        </div>
        <p class="fine">Questions? <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      </div>
    </div>
  </section>
</main>
`;

export function renderLandingPage(origin?: string): string {
    return renderPage({
        title: `${SITE_NAME} — Cook something tonight`,
        description:
            "Show Fridgeezy what's in your fridge and it finds tonight's dinner — recipes from your own ingredients, a whole menu when one dish isn't enough, cooked step by step.",
        origin,
        path: "/",
        styles: STYLES,
        head: `<link rel="preload" href="/assets/fonts/lora-600-italic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/screens/home.webp" as="image" type="image/webp">`,
        body: BODY,
        script: SCRIPT,
    });
}
