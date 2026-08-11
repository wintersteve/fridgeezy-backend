import { renderPage, SITE_NAME, SUPPORT_EMAIL } from "./chrome";

/**
 * The landing page.
 *
 * Two deliberate echoes of the app, because the page's job is to look like the
 * product it advertises:
 *
 * - The hero is the app's welcome screen writ large: the same "Cook something"
 *   headline with the same four rotating claims in Lora semibold italic
 *   (`HEADLINE_WORDS` in the client's welcome screen), the same staggered
 *   fade-up entrance, and the welcome screen's own CTA treatment — a pale green
 *   pill with near-black ink, not the peach fill (which the palette itself
 *   documents as a fill, not a text ground).
 *
 * - The feature tour is styled after cook mode: numbered uppercase eyebrows
 *   ("STEP 1 · YOUR FRIDGE") and a thin progress bar that fills while a step is
 *   active. The numbering is honest — the five steps are the product's actual
 *   loop, fridge to plate — and the progress bar is the same device the app
 *   uses to pace a recipe.
 *
 * The screenshots are real captures of the running app, one per theme, swapped
 * by `prefers-color-scheme` via `<picture>` so the phone's screen always
 * matches the page around it.
 */

interface TourStep {
    /** Asset basename under /assets/screens, suffixed -light/-dark. */
    screen: string;
    eyebrow: string;
    title: string;
    copy: string;
}

const TOUR: TourStep[] = [
    {
        screen: "ingredients",
        eyebrow: "Step 1 · Your fridge",
        title: "Show us what you've got",
        copy: "Snap a photo of your fridge — every ingredient recognized, organized, and remembered.",
    },
    {
        screen: "home",
        eyebrow: "Step 2 · Ideas",
        title: "Get ideas for tonight",
        copy: "Suggestions drawn from what's actually in your kitchen — not a shopping list in disguise.",
    },
    {
        screen: "search",
        eyebrow: "Step 3 · Browse",
        title: "Or go looking yourself",
        copy: "Browse by course, cuisine, difficulty, or diet — down to dairy-free and gluten-free.",
    },
    {
        screen: "recipe",
        eyebrow: "Step 4 · The dish",
        title: "Pick a dish worth cooking",
        copy: "Real recipes with nutrition, difficulty, and hand-painted artwork for every plate.",
    },
    {
        screen: "cook",
        eyebrow: "Step 5 · Cook mode",
        title: "Then cook it, step by step",
        copy: "One step at a time, with the amounts and timers right where you need them.",
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
        title: "Missing one ingredient?",
        copy: "Substitutes that work for the dish you're making — not generic swaps.",
    },
    {
        wash: "var(--secondary-container)",
        ink: "var(--secondary-ink)",
        icon: `<path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5z"/><path d="M9 11h6M9 14h3"/>`,
        title: "Ask anything mid-cook",
        copy: "Chat with a recipe — make it milder, faster, or a step fancier.",
    },
    {
        wash: "var(--primary-container)",
        ink: "var(--primary-ink)",
        icon: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke-linecap="round"/>`,
        title: "Compose a whole menu",
        copy: "Starter to dessert, composed so the courses go together.",
    },
    {
        wash: "var(--tertiary-container)",
        ink: "var(--tertiary-ink)",
        icon: `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2"/>`,
        title: "Lists that write themselves",
        copy: "Anything you're missing lands on a shopping list in a tap.",
    },
];

/** The welcome screen's rotating claims, verbatim. */
const WORDS = ["with leftovers.", "tonight.", "waste-free.", "delicious."];

const STYLES = `
html{scroll-behavior:smooth}

/* ---- hero, after the welcome screen ---- */
.hero{padding:72px 0 40px;text-align:center}
.hero .wordmark{display:inline-block;margin-bottom:40px}
.hero h1{
  font-weight:700;font-size:clamp(40px,7vw,64px);line-height:1.12;
  letter-spacing:-0.5px;color:var(--ink-strong);
}
.hero .cycle{
  display:inline-grid;justify-items:center;
  font-family:'Lora',Georgia,serif;font-style:italic;font-weight:600;
  color:var(--secondary-ink);
}
.hero .cycle span{grid-area:1/1;opacity:0;animation:cycle-word 10s infinite}
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
  max-width:44ch;margin:24px auto 0;
  font-size:18px;line-height:1.55;color:var(--ink-soft);
}
.hero .cta-row{
  display:flex;flex-wrap:wrap;gap:16px;align-items:center;justify-content:center;
  margin-top:36px;
}
.btn-welcome{
  display:inline-block;padding:16px 32px;border-radius:var(--r-pill);
  background:var(--secondary-container);color:var(--on-secondary-container);
  font-weight:700;font-size:16px;text-decoration:none;
  box-shadow:var(--shadow-raised);
  transition:transform .15s ease,box-shadow .15s ease;
}
.btn-welcome:hover{transform:translateY(-1px);box-shadow:var(--shadow-floating)}
.coming-soon{
  display:inline-flex;align-items:center;gap:8px;
  font-size:14px;font-weight:500;color:var(--ink-mid);
}
.coming-soon svg{width:16px;height:16px;fill:currentColor}

/* staggered entrance, the welcome screen's FadeInDown */
@media (prefers-reduced-motion: no-preference){
  .rise{opacity:0;animation:rise .6s cubic-bezier(.22,.61,.36,1) forwards}
  .rise-1{animation-delay:.12s}.rise-2{animation-delay:.22s}
  .rise-3{animation-delay:.3s}.rise-4{animation-delay:.38s}.rise-5{animation-delay:.56s}
  @keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
}
@media (prefers-reduced-motion: reduce){
  html{scroll-behavior:auto}
  .hero .cycle span{animation:none}
  .hero .cycle span:nth-child(n+2){display:none}
  .hero .cycle span:nth-child(1){opacity:1}
}

/* ---- the tour: rail + phone ---- */
.tour{padding:72px 0 24px}
.tour .container{
  display:grid;grid-template-columns:minmax(0,1fr) minmax(0,440px);
  gap:24px 80px;align-items:center;
}
.rail{max-width:460px}
.rail h2{
  font-weight:700;font-size:28px;line-height:36px;color:var(--ink-strong);
  margin-bottom:8px;
}
.rail .lede{font-size:14px;line-height:20px;color:var(--ink-soft);margin-bottom:24px}
.step{
  display:block;width:100%;text-align:left;cursor:pointer;
  background:none;border:0;font:inherit;color:inherit;
  padding:18px 4px 20px;border-top:1px solid var(--outline);
  border-radius:var(--r-md);
}
.step .eyebrow{transition:color .3s}
.step h3{
  font-weight:600;font-size:18px;line-height:26px;letter-spacing:.1px;
  color:var(--ink-muted);margin:6px 0 4px;transition:color .3s;
}
.step p{font-size:14px;line-height:20px;letter-spacing:.25px;color:var(--ink-soft)}
.step .track{
  display:none;height:2px;border-radius:1px;background:var(--outline-solid);
  margin-top:16px;overflow:hidden;opacity:0;transition:opacity .3s;
}
.js .step .track{display:block}
.step .fill{display:block;height:100%;width:0;background:var(--primary)}
.step.active .eyebrow{color:var(--primary-ink)}
.step.active h3{color:var(--ink-strong)}
.step.active .track{opacity:1}
.step.active .fill{animation:tour-fill var(--tour-ms,4600ms) linear forwards}
@keyframes tour-fill{from{width:0}to{width:100%}}
@media (prefers-reduced-motion: reduce){.js .step .track{display:none}}

/* the phone */
.stage{position:relative;display:flex;justify-content:center;padding:24px 0}
.stage .blob{
  position:absolute;border-radius:50%;z-index:0;
  background:radial-gradient(circle,var(--secondary-container) 0%,transparent 70%);
  width:560px;height:560px;top:50%;left:50%;transform:translate(-54%,-50%);
}
.stage .blob.peach{
  background:radial-gradient(circle,var(--primary-container) 0%,transparent 70%);
  width:380px;height:380px;transform:translate(-8%,-72%);
}
.phone{
  position:relative;z-index:1;width:min(300px,72vw);
  aspect-ratio:1206/2622;border-radius:47px;
  background:#1B1917;padding:9px;
  box-shadow:var(--shadow-floating),0 32px 64px rgba(6,6,6,.14);
}
/* on the dark ground the black bezel needs a hairline to keep its edge */
@media (prefers-color-scheme: dark){
  .phone{box-shadow:var(--shadow-floating),0 32px 64px rgba(6,6,6,.4),0 0 0 1px rgba(239,231,221,.09)}
}
.phone .screen{
  position:relative;width:100%;height:100%;overflow:hidden;
  border-radius:38px;background:var(--bg-variant);
}
.phone .slide{position:absolute;inset:0;opacity:0;transition:opacity .55s ease}
.phone .slide img{width:100%;height:100%;object-fit:cover}
.phone .slide.active{opacity:1}

@media (max-width: 860px){
  .tour .container{grid-template-columns:1fr}
  .stage{order:-1}
  .stage .blob{width:420px;height:420px}
  .rail{max-width:none}
}

/* ---- extras ---- */
.extras{padding:72px 0 0}
.extras .eyebrow{margin-bottom:8px}
.extras h2{
  font-weight:700;font-size:28px;line-height:36px;color:var(--ink-strong);
  margin-bottom:32px;
}
.extras .grid{
  display:grid;grid-template-columns:repeat(4,1fr);gap:20px;
}
.card{border-radius:var(--r-xxl);padding:28px 24px 30px}
.card svg{
  width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.8;
  margin-bottom:16px;
}
.card h3{font-weight:600;font-size:18px;line-height:26px;margin-bottom:6px}
.card p{font-size:14px;line-height:20px;letter-spacing:.25px;color:var(--ink)}
@media (max-width: 980px){.extras .grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width: 560px){.extras .grid{grid-template-columns:1fr}}

/* ---- closing ---- */
.closing{padding:96px 0 0}
.closing .band{
  background:var(--secondary-container);border-radius:var(--r-xxl);
  padding:64px 32px;text-align:center;
}
.closing .line{
  font-family:'Lora',Georgia,serif;font-style:italic;font-weight:600;
  font-size:clamp(26px,4vw,36px);line-height:1.3;color:var(--secondary-ink);
  margin-bottom:28px;
}
.closing .btn-surface{
  display:inline-block;padding:14px 30px;border-radius:var(--r-pill);
  background:var(--surface);color:var(--ink-strong);
  font-weight:700;font-size:16px;text-decoration:none;
  box-shadow:var(--shadow-raised);
  transition:transform .15s ease,box-shadow .15s ease;
}
.closing .btn-surface:hover{transform:translateY(-1px);box-shadow:var(--shadow-floating)}
.closing .fine{margin-top:20px;font-size:12px;letter-spacing:.5px;color:var(--ink-mid)}
`;

const SCRIPT = `
document.documentElement.classList.add('js');
(function(){
  var steps=[].slice.call(document.querySelectorAll('.step'));
  var slides=[].slice.call(document.querySelectorAll('.phone .slide'));
  if(!steps.length||steps.length!==slides.length)return;
  var HOLD=4600,timer=null,index=0;
  var still=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(next){
    index=(next+steps.length)%steps.length;
    steps.forEach(function(el,i){
      var on=i===index;
      el.classList.toggle('active',on);
      el.setAttribute('aria-selected',on?'true':'false');
      if(on){ /* restart the fill animation */
        var fill=el.querySelector('.fill');
        if(fill){fill.style.animation='none';void fill.offsetWidth;fill.style.animation='';}
      }
    });
    slides.forEach(function(el,i){el.classList.toggle('active',i===index)});
  }
  function tick(){timer=setTimeout(function(){show(index+1);tick()},HOLD)}
  function stop(){if(timer){clearTimeout(timer);timer=null}}
  function start(){if(!still&&!timer&&!document.hidden)tick()}
  steps.forEach(function(el,i){
    el.addEventListener('click',function(){stop();show(i);start()});
  });
  var tour=document.querySelector('.tour');
  tour.addEventListener('pointerenter',stop);
  tour.addEventListener('pointerleave',function(){stop();start()});
  document.addEventListener('visibilitychange',function(){document.hidden?stop():start()});
  show(0);start();
})();
`;

function renderTourStep(step: TourStep, index: number): string {
    return `<button class="step${index === 0 ? " active" : ""}" role="tab" aria-selected="${index === 0}" aria-controls="slide-${step.screen}">
  <span class="eyebrow">${step.eyebrow}</span>
  <h3>${step.title}</h3>
  <p>${step.copy}</p>
  <span class="track" aria-hidden="true"><span class="fill"></span></span>
</button>`;
}

function renderSlide(step: TourStep, index: number): string {
    return `<picture class="slide${index === 0 ? " active" : ""}" id="slide-${step.screen}">
  <source media="(prefers-color-scheme: dark)" srcset="/assets/screens/${step.screen}-dark.webp">
  <img src="/assets/screens/${step.screen}-light.webp" alt="${step.title} — Fridgeezy screen" width="780" height="1695" ${index === 0 ? "" : 'loading="lazy" '}decoding="async">
</picture>`;
}

function renderExtra(card: ExtraCard): string {
    return `<div class="card" style="background:${card.wash}">
  <svg viewBox="0 0 24 24" aria-hidden="true" style="color:${card.ink}">${card.icon}</svg>
  <h3 style="color:${card.ink}">${card.title}</h3>
  <p>${card.copy}</p>
</div>`;
}

const BODY = `
<main>
  <section class="hero container">
    <span class="wordmark rise rise-1">FRIDGEEZY</span>
    <h1>
      <span class="rise rise-2" style="display:block">Cook something</span>
      <span class="cycle rise rise-3" aria-label="${WORDS.join(" ")}">
        ${WORDS.map((word) => `<span>${word}</span>`).join("\n        ")}
      </span>
    </h1>
    <p class="sub rise rise-4">Show us what's in your fridge — we'll find tonight's dinner.</p>
    <div class="cta-row rise rise-5">
      <a class="btn-welcome" href="#tour">See it in action</a>
      <span class="coming-soon">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.05 12.54c-.03-2.89 2.36-4.27 2.47-4.34-1.35-1.97-3.44-2.24-4.18-2.27-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.02-3.77-1-1.94.03-3.72 1.13-4.72 2.86-2.01 3.49-.51 8.66 1.45 11.5.96 1.39 2.1 2.95 3.6 2.89 1.44-.06 1.99-.93 3.73-.93s2.23.93 3.76.9c1.56-.03 2.54-1.41 3.49-2.81 1.1-1.61 1.55-3.17 1.58-3.25-.04-.02-3.02-1.16-3.04-4.6zM14.16 4.06c.79-.96 1.33-2.29 1.18-3.62-1.14.05-2.52.76-3.34 1.72-.73.85-1.38 2.21-1.2 3.51 1.27.1 2.57-.65 3.36-1.61z"/></svg>
        Coming soon to the App Store
      </span>
    </div>
  </section>

  <section class="tour" id="tour">
    <div class="container">
      <div class="rail" role="tablist" aria-label="What Fridgeezy does">
        <h2>Fridge to plate, in five steps</h2>
        <p class="lede">Tap a step, or let it cook.</p>
        ${TOUR.map(renderTourStep).join("\n        ")}
      </div>
      <div class="stage">
        <span class="blob" aria-hidden="true"></span>
        <span class="blob peach" aria-hidden="true"></span>
        <div class="phone">
          <div class="screen">
            ${TOUR.map(renderSlide).join("\n            ")}
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="extras">
    <div class="container">
      <p class="eyebrow">And when you need it</p>
      <h2>Little helpers, on hand</h2>
      <div class="grid">
        ${EXTRAS.map(renderExtra).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="closing">
    <div class="container">
      <div class="band">
        <p class="line">Cook something delicious, tonight.</p>
        <a class="btn-surface" href="mailto:${SUPPORT_EMAIL}">Get in touch</a>
        <p class="fine">${SITE_NAME} is coming to the App Store.</p>
      </div>
    </div>
  </section>
</main>
<script>${SCRIPT}</script>
`;

export function renderLandingPage(origin?: string): string {
    return renderPage({
        title: `${SITE_NAME} — Cook something tonight`,
        description:
            "Show Fridgeezy what's in your fridge and it finds tonight's dinner — recipes from your own ingredients, cooked step by step.",
        origin,
        path: "/",
        styles: STYLES,
        head: `<link rel="preload" href="/assets/fonts/lora-600-italic.woff2" as="font" type="font/woff2" crossorigin>`,
        body: BODY,
        hideNav: true,
    });
}
