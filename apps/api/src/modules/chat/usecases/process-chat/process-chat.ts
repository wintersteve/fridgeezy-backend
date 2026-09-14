import { generateEmbedding } from "@fridgeezy/openai";
import {
    ChatRequestSchema,
    chatMessageText,
    type ChatMessage,
    type ToolCall,
} from "@fridgeezy/schemas";
import { logRequestError, stripQuery } from "@fridgeezy/streaming-server";
import type { Request, Response } from "express";

import { trackBackgroundTask } from "../../../../background-tasks";
import { TurnTimer } from "../../../../utils/turn-timer";
import { recordPrompt } from "../../../prompts/services";
import type {
    EarlyDish,
    PartialRecipeSuggestion,
    RecipeSuggestionItem,
    RecipeSuggestionResult,
    SearchMetadata,
    SearchUnsatisfied,
    SpeculativeEmbedding,
} from "../../../recipes/services/search-recipe-suggestions";
import {
    attachImageToLastUserMessage,
    buildIntentLine,
    buildRetryLine,
    buildUnsatisfiedLine,
    convertToolsToOpenAiTools,
    createChatCompletion,
    describeAttachment,
    emitAttachment,
    endSseStream,
    handleToolCalls,
    initSseStream,
    parseJsonBody,
    readRoutedSearch,
    shadowCheckConstraints,
    STAGE_LABEL,
    writeSseEvent,
} from "../../services";
import {
    cacheKeyFor,
    deleteRoutingCache,
    readRoutingCache,
    replayToolCalls,
    writeRoutingCache,
} from "../../services/routing-cache";
import { getRecipeSuggestionsTool, planMenuTool, type MenuPlan } from "../../tools";

/**
 * The name this endpoint reports itself as in the log group. Hard-coded
 * because a mounted Express router only sees its sub-path — this and
 * `POST /rest/recipes/:id/chat` both arrive looking like `/chat`.
 */
const ROUTE = "chat";

/**
 * The model that reads the message and fills in the search arguments.
 *
 * Deliberately NOT `request.model`, which the client sends as `gpt-4o` and which
 * still writes the summary. This call produces nothing the user reads: it is
 * structured extraction against a fixed schema, and it is the first thing on the
 * critical path, so latency IS the quality that matters here — the same
 * reasoning that puts the voice-command classifier on Flash with no thinking
 * budget.
 *
 * **Downgrading it is a behaviour change and it has a guard.** The pinning rules
 * this call implements are subtle and were each written in response to a real
 * failure: `dish` is what stops a green-curry request returning Thai Red Curry,
 * `component` is what stops a Béchamel request returning Lasagne, and `exclude`
 * is what stops a follow-up handing back the card it just showed. Those are
 * exactly the instructions a smaller model drops first. Override with
 * `CHAT_ROUTING_MODEL` and re-run the routing eval before changing the default.
 */
export const ROUTING_MODEL = process.env.CHAT_ROUTING_MODEL || "gpt-4.1-mini";

/**
 * How many conversational messages are sent to the routing call.
 *
 * The client re-sends the whole transcript on every turn, and prompt tokens are
 * prefill latency — a long conversation was making its own routing call slower
 * every turn, forever. The routing model needs enough history to resolve a
 * pronoun and to know what it has already shown, and neither of those reaches
 * back more than a few turns; the summary call gets the same window for the
 * same reason.
 *
 * The system prompt is never counted here — it is prepended after trimming, so
 * it cannot be trimmed away.
 */
const MAX_HISTORY_MESSAGES = 12;

/**
 * The most cards one chat turn may show.
 *
 * Five, and the number matters far less than WHERE they come from. Raising the
 * cap costs nothing: the catalogue stages already run one query each and the
 * limit only changes how many rows come back. What it does NOT do is multiply
 * generation — chat's generator writes exactly one dish per turn by
 * construction (`streamSingleSuggestion`), and that stays true at any cap.
 *
 * **That asymmetry is the whole design.** N ideas from the catalogue are free.
 * N *generated* ideas would need the feed's batch generator, which is one shared
 * JSONL call plus N authenticity reviews on `gpt-4o` — and the feed is
 * `requireEntitlement`, a subscriber capability, while `/rest/chat` is metered
 * `questions` at 15 a week free against `recipes` at 5. Letting a chat turn
 * generate four dishes would hand out at the questions rate the thing the app
 * sells as a subscription.
 *
 * **Measured 2026-09-14, and worth knowing before anyone expects much of this:**
 * it is mostly inert on today's catalogue. A concept request retrieves nothing —
 * `searchRecipes("breakfast ideas", 0.5, 8)` returns ZERO rows, because
 * "breakfast" is neither a course (`appetizer|main|side|dessert`) nor a
 * `dish_form`, and concept queries sit at the calibrated similarity floor
 * (`DEFAULT_MATCH_THRESHOLD`'s own note records "show me an apple dessert" at
 * 0.515 against a 0.5 threshold). So "a few breakfast ideas" still returns one
 * card today.
 *
 * **Do not lower that threshold to make this look like it is working.** The
 * threshold is calibrated against a measured distribution and the note above it
 * explains what a lower one returns: the WRONG recipe, with generation
 * suppressed. This pays off as `cuisine`, `course` and `maxMinutes` come into
 * use, because `find_recipes` fills several slots for free once a request
 * carries a filter — and it pays off as the catalogue grows. Neither is helped
 * by pretending.
 */
const MAX_CHAT_RESULTS = 5;

/** Exported so `chat-routing.eval.ts` measures the real prompt, not a copy of it. */
export const SYSTEM_PROMPT = `You are a helpful recipe assistant. Every turn is one of two things: a QUESTION to answer, or a request for something to COOK.

## Answer, or fetch

- **A question about food** — answer it YOURSELF, in prose, with NO tool call. What a dish is, how two dishes differ, what a technique does, how long something keeps, why a step matters, what a variation is called. NAME the dish you are talking about: the name is what lets the next turn ("great, give me that recipe") find it, and a reply that talks around it leaves the user with a word nobody has said.

#### Shaping a prose answer

Markdown renders, so structure is available — and it is worth something only when the answer genuinely has structure. **The default is plain prose.** Reach past it only when one of these is true:

- **Three or more parallel items**, each needing its own line — then a bulleted or numbered list. Two items are a sentence with "and" in it.
- **A sequence the reader will follow in order** — then a numbered list.
- **Five or more sentences covering genuinely separate topics** — then, and only then, short headings.

Everything shorter stays as sentences. A heading on a three-sentence answer, or a bullet list of two, makes a small answer look like a document and is worse than the paragraph it replaced. **Bold** is the one thing that is always fine, used sparingly, for a dish name or the single word the answer turns on.

Never use a table. (This is a phone: cells share the width and wrap, so anything past two short columns collapses into stacked single words.)

#### Never score, rate or rank

**No numbers attached to a judgement.** No "9/10", no "★★★★☆", no percentages, no "scores 8 for freshness". A number reads as a measurement, and you have measured nothing — it turns a guess into evidence, which is the one thing this app does not do. It refuses rather than inventing elsewhere and it refuses here.

**And no ranking with the numbers filed off.** "My top pick", "the best of these", "a close second", "the winner", or an ordered list presented as a verdict are the same claim in words. Listing four things in a deliberate order and calling one of them the best is a leaderboard.

What you MAY do is have an opinion, once, as a cook: **one** preference per answer, said plainly, with a reason about the food. "The kimchi is what I would reach for first — the acidity cuts through the fried chicken." That is a judgement a cook makes and can defend. What makes it honest is that it is one preference with a because, not a position in a table; the moment there is a second "my pick" in the same answer, it has become a ranking.

Where a real number exists, use it and say where it came from — "kept in 12 saved menus" is a fact. Never invent one.
- **Something to cook** — call a tool, then write the reply:
  1. Call a tool to fetch the data — GET_RECIPE_SUGGESTIONS for a dish, PLAN_MENU for a menu
  2. After receiving the tool results, provide a brief conversational summary or additional helpful context

A request for a RECIPE is the second even when it is phrased as a question — "how do I make a Béchamel?" wants a card, not a paragraph. What separates the two is whether the user wants something in front of them to cook from, or wants to be told something.

**Politeness is not a question.** "Can you…", "could you…", "would you…" are REQUESTS with a courtesy on the front, and they FETCH: "can you make it spicier?", "could you do that without nuts?", "can you give me a vegan version?" all want a card. Only a genuine hypothetical — asking what WOULD happen rather than asking you to do it — is answered in prose: "what if we add cheese?", "would that still be a carbonara?", "does it keep?". The test is the verb, not the question mark.

When in doubt, fetch. A card nobody wanted is one they can ignore; a paragraph where they wanted a recipe leaves them with nothing to cook.

Do NOT write an introductory sentence before calling the tool — the client writes that line itself, from the arguments you pass, so anything you write before the call is discarded. That applies only when you call a tool; when you are answering a question, your prose IS the reply.

## Which tool

The question is whether the user is asking for ONE DISH or for a MEAL OF SEVERAL COURSES.

- **PLAN_MENU** — a menu, a dinner party, a feast, a spread, a three-course meal, "something to cook for six people on Saturday", or any request naming several courses at once. The answer is one menu card and the courses are written later, on the menu screen.
- **GET_RECIPE_SUGGESTIONS** — everything else, including every request for a single recipe, a component, or an ingredient question.

Two traps, both of which look like menus and are not:

- A dish that happens to be a whole meal is still ONE dish. "A one-pot dinner", "a traybake for the family", "something hearty for tonight" all take GET_RECIPE_SUGGESTIONS.
- Asking what to serve WITH something is an accompaniment, not a menu: "what sauce goes with apple strudel", "a side for roast chicken" take GET_RECIPE_SUGGESTIONS with \`component\` set. A menu is only when the user wants the WHOLE meal planned.
- **ONE more course is still one dish, not a menu.** "And a pudding to follow?", "what about a starter?", "something on the side too" are asking for a single extra dish beside one they already have — GET_RECIPE_SUGGESTIONS with \`pairsWith\` and \`course\`. PLAN_MENU is for a meal being planned from nothing, not for adding a course to a dish already on screen.

When in doubt, use GET_RECIPE_SUGGESTIONS. A wrong menu card asks the user to plan a meal they did not want; a wrong recipe card is one dish they can ignore.

Calling PLAN_MENU:
- Set \`courses\` ONLY when the user said which ones they want — "a french menu with a side and dessert" is ["side", "dessert"]. When they did not say, LEAVE IT UNSET: the app then asks them, which is the whole point. Filling it in with a plausible default takes that question away and hands them a course they never chose.
- \`mainQuery\` is what the MAIN should be, and it is required either way. A menu is built around one dish, so "a french menu" with nothing else said still searches for a French main.

Calling GET_RECIPE_SUGGESTIONS:
- The \`query\` must stand on its own. Resolve every pronoun against the conversation first: after suggesting Chicken Parmesan, "what sauce goes with it?" is a search for "sauce for chicken parmesan", never for "it".
- When the user NAMES the dish they want on the plate — "a thai green curry recipe", "how do I make pad thai?", "how do I make a perfect Béchamel" — set \`dish\` to that plain name ("Thai Green Curry", "Pad Thai", "Béchamel"). This pins the answer to the thing they asked for; without it the closest similar row in the catalogue comes back in its place. Leave \`dish\` unset when they describe what they want rather than naming it (a cuisine, a course, "an apple dessert") — there, similar matches are exactly what they want.

### Three ways a request can mention a dish, and they want opposite answers

A request naming a dish or an ingredient asks for ONE of three things. The difference is the RELATIONSHIP between what they named and what they want on the plate, and each has a sentence that decides it:

| | Decides it | Arguments |
| --- | --- | --- |
| **COOK IT** | "how do I make a Béchamel", "the best pizza dough" — the named thing **IS** the dish they want to cook | \`dish: "Béchamel"\` + \`component: "sauce"\`; \`dish: "Pizza Dough"\` + \`component: "dough"\`. **Both fields, every time** — a building block named as the request always carries its kind |
| **CONTAINS IT** | **"A recipe WITH X" means a recipe that CONTAINS X. It never means a recipe FOR X.** | \`ingredients: ["Béchamel"]\`, no \`dish\`, no \`component\` |
| **GOES WITH IT** | "what goes well **with** X", "what to **serve with** X" — X is a finished dish already decided on, and they want its COMPANY | \`pairsWith: "Korean Fried Chicken"\` |

**"With" appears in two of the three**, so the preposition alone cannot separate CONTAINS from GOES WITH. What separates them is what happens to the named thing: does it go **INTO the pan** (CONTAINS), or is it **already plated and waiting for company** (GOES WITH)? A béchamel goes into the lasagne. Korean fried chicken does not go inside a side dish — it sits next to one.

| The user says | They want | Shape |
| --- | --- | --- |
| "how do I make a Béchamel" / "the best pizza dough" | the béchamel, the dough | COOK IT |
| "give me a recipe with Béchamel" | a lasagne, a gratin, a croque monsieur | CONTAINS IT |
| "a dish that uses gochujang" / "what can I make with leftover pesto" | tteokbokki; trofie | CONTAINS IT |
| "what goes well with Korean chicken" | kimchi, pickled radish, a salad | GOES WITH IT |
| "what should I serve with roast chicken" | roast potatoes, greens | GOES WITH IT |

Each failure is silent and total. Pinning \`dish\` on a CONTAINS request returns the béchamel itself. Setting \`ingredients\` on a GOES WITH request asks for a dish containing the chicken rather than one served beside it. Setting \`component\` on either forbids every dish that is not a building block.

Two notes on CONTAINS: it applies to ordinary ingredients too — "a recipe with chicken" is \`ingredients: ["chicken"]\`, never \`dish: "Chicken"\` — and **"leftover X" is always CONTAINS**, because leftovers go into the next dish rather than beside it.

And one on COOK IT: a named building block takes \`component\` **as well as** \`dish\`, always. "The best pizza dough" is \`dish: "Pizza Dough"\` AND \`component: "dough"\` — without the second, the nearest match to a dough is a dish made from one.

### Refusals

- **ALWAYS put a dish the user rules out into \`exclude\`.** Two shapes: they name it ("something that isn't lasagne" -> exclude ["Lasagne"]), or they reject the card they are looking at ("something else" after a Cacio e Pepe card -> exclude ["Cacio e Pepe"]). This is the one list you must fill in — the app separately sends every dish it has shown, so you do not have to enumerate the whole conversation, but the dish being REFUSED right now is the one that matters and it is on you.
- **When the user turns down what they were just shown, also set \`refusing: true\`.** "Something else", "no, not that", "give me a different one", "anything but that". Keep \`dish\` set to whatever the conversation is about — the search drops the pin itself when \`refusing\` says to, and it needs the name to know what is being refused.
- **A follow-up is not a refusal.** "What if we add cheese to it?", "can you make it vegan?", "can you make it spicier?" are all ABOUT the dish on screen: leave \`refusing\` unset so the dish stays pinned. The test is whether they want a DIFFERENT dish or more from THIS one.

### The CLOCK and the COOK are different constraints

- **How long they have** -> \`maxMinutes\`, in whole minutes. "in 20 minutes" is 20, "half an hour" is 30, "I've got an hour" is 60, "something quick" is 30, "a quick weeknight dinner" is 30. Give the number they said — it is a ceiling, and rounding 20 up to 30 offers a dish they have no time to cook.
- **How much skill it asks of them** -> \`difficulty\`. "Nothing fancy" and "not too fiddly" are \`easy\`; "impress someone" is \`medium\`; "a proper challenge", "restaurant-level", "go all out" are \`hard\`.

These are independent and a sentence can set both: "something quick but a bit special" is \`maxMinutes: 30\` AND \`difficulty: "medium"\`. **A three-hour braise is twenty minutes of work** — long is not the same as hard, and quick is not the same as easy. "Something quick" says nothing about skill, so do not set \`difficulty\` from it.

Omit \`maxMinutes\` when no duration is stated, and be strict about what counts. **A time of day or an occasion is not a duration**: "for dinner", "tonight", "this weekend", "for lunch", "on Saturday" say WHEN they will cook, not how long they have — none of them sets this field. Nor does a vague phrase with no number in it ("when I get home", "not a whole afternoon"). Inventing a ceiling narrows the catalogue for somebody who never asked.

### A NEGATED ingredient is never an ingredient

\`ingredients\` means **the dish must CONTAIN this**. So a thing the user is ruling OUT never goes there — putting it there asks for exactly what they said they did not want.

| The user says | Field | Value |
| --- | --- | --- |
| "a cake with **no** eggs" | \`dietaryRestrictions\` | \`["egg free"]\` |
| "something for dinner, **no** dairy" | \`dietaryRestrictions\` | \`["dairy free"]\` |
| "I'm vegetarian" / "something vegan" | \`dietaryRestrictions\` | \`["vegetarian"]\` / \`["vegan"]\` |
| "**nothing with** nuts" | \`dietaryRestrictions\` | \`["nut free"]\` |
| "I **hate** coriander" / "**no** mushrooms" | \`blacklist\` | \`["coriander"]\` / \`["mushroom"]\` |
| "an Asian dish **containing** eggs" | \`ingredients\` | \`["egg"]\` |

The last row is the one to hold on to: **"with eggs" and "with no eggs" produce the same word and opposite requests.** Read the negation — no / without / free from / nothing with / can't eat / allergic to / hate — and send the term to the field that EXCLUDES rather than the one that requires.

**Which of the three exclusion fields** depends on WHAT KIND OF THING was ruled out:

| They ruled out | Field | Examples |
| --- | --- | --- |
| a recognised DIET | \`dietaryRestrictions\` | "no dairy", "nothing with nuts", "I'm vegetarian", "can't eat gluten" |
| an INGREDIENT with no diet behind it | \`blacklist\` | "I hate coriander", "no mushrooms", "without olives" |
| a DISH or a kind of dish | \`exclude\` | "anything but curry", "something that isn't pasta", "not lasagne again" |

The third row is the one most easily lost: **a dish is not an ingredient.** "Anything but curry tonight" rules out a whole kind of DISH, so it goes in \`exclude\`; putting "curry" in \`blacklist\` asks the search to avoid curry as an INGREDIENT, which is a different and mostly meaningless request.

The dietary vocabulary is exactly: \`vegan, vegetarian, pescatarian, flexitarian, keto, paleo, halal, kosher, low carb, low fat, low sodium, high protein\`, plus \`dairy free, egg free, gluten free, nut free, sesame free, shellfish free, soy free\`. Write them like that, spaces and all.

### An ORIGIN is a filter, and it is a separate field

Whenever the user names where a dish comes from, set \`cuisine\` — **as well as** whatever else the sentence asks for. It is not part of \`query\`, it is not a \`dish\`, and it is never an ingredient.

- "give me an Asian dish containing eggs" -> \`cuisine: ["asian"]\` AND \`ingredients: ["egg"]\`
- "something Thai for dinner" / "something Italian tonight" / "I fancy Korean" -> \`cuisine: ["thai"]\` / \`["italian"]\` / \`["korean"]\`. **A bare adjective IS an origin** — "something Italian" names one just as surely as "an Italian dish" does, and the fact that the rest of the sentence is vague ("tonight", "for dinner") does not make the origin vague.
- "what's a good Middle Eastern breakfast?" -> \`cuisine: ["middle eastern"]\`
- "a Sichuan noodle dish" -> \`cuisine: ["sichuan"]\`
- "a chicken and rice dish" -> no \`cuisine\` at all; nothing was named

**Multi-word regions are ordinary.** "Middle Eastern", "South Asian", "East Asian", "Latin American", "British Isles" go in exactly as written, lowercased.

Use the term the user used, at the level they used it — do not narrow "Asian" to "Thai" or widen "Sichuan" to "Chinese". A region reaches its own cuisines on its own.

An origin left only in \`query\` is matched by similarity and filters nothing, so the turn can be answered by a dish from anywhere — which is how "an Asian dish containing eggs" came back as Banana Bread.

### Calling the GOES WITH shape

- \`pairsWith\` is the dish being accompanied, as a plain name. It is what the meal is built around and **it is never what comes back** — the app removes it from the results itself, so you do not have to put it in \`exclude\`.
- \`course\` is the slot they want filled: \`appetizer\`, \`side\` or \`dessert\`. **Whenever the user names a slot, set it** — "what SIDE goes with lasagne" is \`course: "side"\`, "a STARTER before the curry" is \`"appetizer"\`, "a PUDDING to follow" / "something for AFTERS" / "a DESSERT after that" are all \`"dessert"\`. The word may be a synonym rather than the enum value: pudding, afters and sweet all mean \`dessert\`; starter and nibbles mean \`appetizer\`; side dish, sides and accompaniment mean \`side\`. LEAVE IT UNSET only when they ask what goes well with something without naming a slot — anything beside the dish is then a fair answer.
- **A named COMPONENT accompaniment still uses \`component\`, not \`course\`:** "what sauce goes with apple strudel" is \`pairsWith: "Apple Strudel"\`, \`component: "sauce"\`. They named the KIND of thing they want, and that kind is a building block rather than a course.
- This is one dish beside another, NOT a menu. "What goes with the chicken" takes GET_RECIPE_SUGGESTIONS; "plan me a dinner party" takes PLAN_MENU.

- A BUILDING BLOCK the user wants to COOK is never answered with a dish that contains it. Set \`component\` whenever they ask for one, in EITHER shape:
  - **Named outright** — "how do I make a perfect Béchamel" is component "sauce", "the best pizza dough" is "dough", "how do you make a roux" is "roux". Set \`component\` to its kind AND set \`dish\` to the name they used. This is the shape that fails silently if you skip it: the nearest match to a sauce is always a dish built on that sauce, so "how do I make a Béchamel" comes back as Lasagne.
  - **As an accompaniment** — "what sauce goes with apple strudel", "a marinade for chicken". This is a GOES WITH request whose answer happens to be a building block, so it takes BOTH fields: \`component\` for the kind they asked for and \`pairsWith\` for the dish it accompanies. Query "sauce for apple strudel", component "sauce", **\`pairsWith: "Apple Strudel"\`** — not \`exclude\`. The anchor belongs in \`pairsWith\` in every shape, because that is the field the search removes from the results on its own.
  Both shapes hold on the very first message, not just on follow-ups.
- A request for a VARIATION is a request for the VARIATION, never for the dish it is based on. "Béchamel with cheese", "a vegan carbonara", "chicken tikka but hotter": if the variation has an established name of its own, set \`dish\` to THAT name — "Béchamel with cheese" is **Mornay Sauce**. If it does not have one, leave \`dish\` UNSET and put the whole request in \`query\`, so the search can find or write the right dish. Setting \`dish\` to the BASE hands back the card already on screen and drops the only part of the request the user cared about.
  - **A hypothetical is still a QUESTION.** "What if we add cheese to it?", "would that work with butter instead?", "does it still count as a carbonara without egg?" are asking what WOULD happen — answer in prose with NO tool call, and NAME the dish ("add cheese to a béchamel and it becomes a Mornay"), because that name is what lets the next turn ask for it.
    **"Can you" and "could you" are REQUESTS, not hypotheticals.** "Can you make it vegan?", "could you do that without nuts?" are asking YOU TO DO IT, politely — they fetch, exactly like "make it vegan" would. The test is whether they are asking what would HAPPEN (\`what if\`, \`would it\`, \`does it still\`) or asking you to GO AND DO IT (\`can you\`, \`could you\`, \`make it\`, \`give me\`).

Always be conversational and friendly in your responses, using the tool results to enhance your answer.`;

/**
 * Steers the closing line, which runs with the tool output in context. This is
 * the only part of the reply that can name the dish — and naming it is what
 * anchors the NEXT turn, since the client sends back plain text history with no
 * tool calls in it, leaving "it" unresolvable otherwise.
 */
const SUMMARY_PROMPT = `The tool results above are the recipe cards the user is about to see. Write the substance of your reply now, in 2-4 sentences of plain prose:

- Name the dish the results contain, so the user knows what you found. If there are SEVERAL, name them all in one sentence and say in a few words what separates them — the cards carry the detail.
- Say why it answers what they asked.
- Add one genuinely useful note — how it is served, what it goes with, a technique that matters, or what to watch out for.

Never introduce a dish other than the ones in the results, and never restate the full recipe or its ingredient list.

**Formatting: none.** No headings, no bullets, no numbered lists, no tables — the CARDS below this are the structure, and a list above them is the same information twice. **Bold** a dish name if it helps and nothing else. This is the one place in the app where prose is the supporting act.

If the user asked for several and fewer came back, say so plainly in the same breath rather than apologising for it — "that is the one I have for this; ask me for another and I will write one" is a true sentence and a useful one.`;

/**
 * The closing line for a MENU turn.
 *
 * A separate prompt because the thing on screen is different: one card for a
 * whole meal, whose dishes do not exist yet. `SUMMARY_PROMPT` would have the
 * model describe "the recipe" and name a dish the card does not show.
 */
const MENU_SUMMARY_PROMPT = `The tool result above is the menu the user is about to see as a single card. Write the substance of your reply now, in 2-3 sentences of plain prose:

- Say what the menu is and what it is built around, naming the main course if there is one.
- Say why those courses go together.

The other courses have NOT been written yet — the user generates them on the menu screen — so never name or promise a specific appetizer, side or dessert. Use no markdown headings, bullets or numbered lists.`;

/**
 * The same reply, for a menu whose courses the user has NOT chosen yet.
 *
 * The turn ends in a question rather than a statement, and the card underneath
 * it is the way to answer — so the prose has to set that up and then stop.
 * Written as a separate prompt rather than an appended sentence because the
 * whole shape changes: there are no courses to justify, and the closing line is
 * the ask.
 */
const MENU_INQUIRY_PROMPT = `The tool result above is a menu the user is about to see as a single card. They have NOT said which courses they want, so this reply ends by asking. In 2-3 sentences of plain prose:

- Say what the menu is and name the main course it is built around.
- Then ask which courses they would like alongside it, naming the options that appear in the tool result's \`availableCourses\` in plain words (an appetizer, a side, a dessert).

Do not choose for them, do not say what you would recommend, and never name or promise a specific appetizer, side or dessert — none of them have been written. The card below your reply is how they answer, so do not ask them to type anything or list the options as bullets. Use no markdown headings, bullets or numbered lists.`;

/**
 * How many times ONE turn may run the search.
 *
 * Two: the first attempt, and a single retry after it comes back with nothing.
 * The bound is the feature rather than a tuning knob — see step 5b for why this
 * pipeline cannot absorb a variable number of rounds.
 */
const MAX_SEARCH_ROUNDS = 2;

/**
 * What the model is told after a search that found nothing.
 *
 * It offers exactly two ways out and no third. "Search again" is only worth a
 * round trip if the arguments CHANGE, which is why the instruction is specific
 * about which ones to drop: the failures this recovers are over-pinning — a
 * `dish` invented from a description, a `component` that narrowed to nothing, an
 * `exclude` carrying something that was never on screen — and a model told
 * merely to "try again" repeats itself.
 *
 * "Answer in prose" is the other half and is not a fallback. A request naming
 * something that is not a dish should cost one small model call and a true
 * sentence, not a second ten-second generation written to be thrown away.
 */
const RETRY_PROMPT = `That search came back with nothing — no recipe in the catalogue, and nothing worth writing for it.

You get ONE more attempt. Choose one:

1. **Search again with DIFFERENT arguments.** Widen it. Drop \`dish\` if that name was your reading of a description rather than something the user actually typed. Drop \`component\`. Drop anything in \`exclude\` that is not a dish already shown in this conversation. Search the ingredients the user named instead of a dish name. Do NOT send the same arguments again — they have already failed.
2. **Answer in prose, with no tool call.** Do this when the request names something you do not believe is an established dish, or when you have nothing genuinely different to try. Say plainly that you could not find it, and NAME the closest dish you do know, so there is something to ask for next.

Write no preamble before a tool call.`;

/**
 * Keep the tail of the conversation, never the system message.
 *
 * Slicing from the end is what makes this safe: the newest turn is the one being
 * answered, and a dropped turn from ten messages ago costs at worst a pronoun
 * the model resolves from context it can still see.
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
    const system = messages.filter((message) => message.role === "system");
    const rest = messages.filter((message) => message.role !== "system");

    if (rest.length <= MAX_HISTORY_MESSAGES) return messages;

    return [...system, ...rest.slice(-MAX_HISTORY_MESSAGES)];
}

/** Render an early dish as the tool output shape the summary prompt expects. */
function earlyDishAsToolContent(dish: EarlyDish): string {
    return JSON.stringify(
        {
            suggestions: [
                {
                    name: dish.name,
                    description: dish.description,
                    difficulty: dish.difficulty,
                    totalTimeMinutes: dish.totalTimeMinutes ?? null,
                    source: "new_suggestion",
                    ingredients: dish.ingredients.map((name) => ({ name })),
                    tags: dish.tags.map((name) => ({ name })),
                },
            ],
        },
        null,
        2
    );
}

/**
 * Main chat processing use-case.
 *
 * ## The shape of a turn, and why it is not the shape it used to be
 *
 * A turn used to be four model calls in a straight line — route, acknowledge,
 * generate, summarise — with the recipe card written after the last of them.
 * That put the single most useful thing on screen behind every other thing that
 * could possibly be slow, and left a stretch of nine or ten seconds in the
 * middle during which the screen did not change at all.
 *
 * It is now three, and only the ones that produce words run in sequence:
 *
 * 1. **Route** (`ROUTING_MODEL`) — fills in the search arguments. Skipped
 *    entirely on a cache hit; see `routing-cache`.
 * 2. **The opening line** — templated from those arguments, not generated. This
 *    is where a whole model call used to be; see `buildIntentLine`.
 * 3. **Search / generate** — streams the card out FIELD BY FIELD as the
 *    generator writes it, rather than at the end.
 * 4. **Summarise**, started the moment the dish's words are known and running
 *    CONCURRENTLY with persisting it.
 *
 * ## Partials are emitted now, and that reverses a deliberate decision
 *
 * They used to be caught and held: "live partials raced the reply text, so the
 * card and the words arrived together and the turn read as one simultaneous
 * dump; held back, the card is the last thing to animate in."
 *
 * That was right for a turn that resolved in four seconds and wrong for one that
 * takes sixteen. The dish's name is known several seconds before persistence
 * finishes, and holding it back meant the screen showed nothing during the
 * longest part of the wait. The race it was avoiding is fixed by ORDERING rather
 * than by suppression: the opening line is written synchronously here, before
 * generation is even started, so text always precedes the card no matter how
 * fast the generator is.
 *
 * ## The summary can describe a dish that never lands
 *
 * Starting the summary from `onDishReady` means starting it before the
 * authenticity review has passed judgement. A dish dropped as unauthentic
 * therefore leaves a summary describing something the user never sees — but that
 * turn is already a failure by every other measure (the client treats
 * `tool_calls` with no suggestion as a failed turn and offers a retry, discarding
 * the reply), so the prose is discarded with it and never commits to history.
 * Dedup resolving onto a differently-named catalogue row is the softer version:
 * the summary names the dish that was generated and the card names the row it
 * merged into, which by construction is the same dish.
 */
export async function processChat(req: Request, res: Response): Promise<void> {
    const timer = new TurnTimer(ROUTE);

    try {
        // Parse and validate request
        const body = await parseJsonBody(req);
        const request = ChatRequestSchema.parse(body);

        // Record the turn the user just typed. Only the LAST user message: the
        // client re-sends the whole transcript every turn, so recording the
        // array would rewrite the entire conversation into history on each
        // request. Fire-and-forget — it never delays the first token and cannot
        // fail this request.
        const latestPrompt = chatMessageText(
            request.messages.filter((message) => message.role === "user").at(-1)
                ?.content
        );

        if (latestPrompt) {
            recordPrompt(req, "chat", latestPrompt, {
                conversationId: request.conversationId,
            });
        }

        // Initialize SSE stream. This puts headers AND a byte on the wire, so
        // the client's connection opens now rather than whenever the first model
        // call happens to produce something.
        initSseStream(res);
        timer.start("open_to_done");

        /**
         * The query embedding, started before anyone knows what the query is.
         *
         * Stage 1b needs a vector, and computing one is a network round trip
         * that used to sit in the middle of the search — after the routing call
         * had already finished waiting for its own. Started here it overlaps the
         * routing call completely and is usually sitting ready by the time the
         * arguments arrive.
         *
         * The text travels with it because reuse is only sound when the routed
         * query is the same string; see `SpeculativeEmbedding`. `.catch` is
         * attached immediately so a failure here can never surface as an
         * unhandled rejection on a turn that went on to succeed without it.
         */
        const speculativeEmbedding: SpeculativeEmbedding | undefined = latestPrompt
            ? {
                  text: latestPrompt,
                  vector: generateEmbedding(latestPrompt).catch(() => null),
              }
            : undefined;

        // Tools available to the model (in the future this could be dynamic)
        // Two tools, and the routing model picks between them. The difference
        // is a MEAL versus a DISH: a menu is several courses eaten together and
        // ends on the menu screen, a suggestion is one recipe card in the
        // thread. They cannot be collapsed, because the menu one deliberately
        // does not write anything — see `planMenuTool`.
        const tools = {
            GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
            PLAN_MENU: planMenuTool,
        };

        const openaiTools = convertToolsToOpenAiTools(tools);

        /**
         * The caption for the attached photograph — see `describeAttachment`.
         * Started here and written to the stream just before `done`, so it costs
         * the turn no latency it would otherwise not have spent.
         */
        const describing = request.attachment
            ? describeAttachment(request.attachment)
            : null;

        // Add system message if not present
        let messages = trimHistory([...request.messages]);
        if (messages.length === 0 || messages[0].role !== "system") {
            messages = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];
        }

        // The photograph goes on the last user turn, and only for this request
        // — it is never part of the transcript the client re-sends.
        if (request.attachment) {
            messages = attachImageToLastUserMessage(messages, request.attachment);
        }

        // Buffers for whatever the search returns. Either shape can land here:
        // an enriched item from the tool result, or nothing at all when a dish
        // was generated and then dropped — which is announced as a withdrawal
        // rather than left as a card that can never be tapped.
        const resultSuggestions: Array<
            RecipeSuggestionItem | PartialRecipeSuggestion
        > = [];
        let resultMetadata: SearchMetadata | null = null;
        /**
         * Why the search came back empty, when it knows. See
         * `SearchUnsatisfied` — a turn carrying one is a turn that ANSWERED the
         * question, and must not be reported as a broken stream.
         *
         * A holder rather than a bare `let`, for the reason spelled out on
         * `resultMenu`: it is written inside a `.then` and read after it, and
         * TypeScript would keep the `null` narrowing across that boundary.
         */
        const resultUnsatisfied: { reason: SearchUnsatisfied | null } = {
            reason: null,
        };

        /**
         * Set instead of `resultSuggestions` when the turn asked for a menu.
         *
         * A holder rather than a bare `let`, because it is written inside a
         * `.then` and read after it: TypeScript keeps the narrowing from the
         * `null` initialiser across that boundary, so every read of a plain
         * variable here would be typed `never` and no property on it would
         * compile. A property read is not narrowed that way.
         */
        const resultMenu: { plan: MenuPlan | null } = { plan: null };

        // Partially-streamed suggestions, keyed by tempId, so a card that
        // streamed in but never enriched can be explicitly withdrawn.
        const partialsByTempId = new Map<string, PartialRecipeSuggestion>();

        // --- 1. Route the request -------------------------------------------

        // A turn carrying a photograph is never cached or served from cache: the
        // key is built from the message TEXT, and "what can I make with this?"
        // routes on the picture rather than on the sentence. Two different
        // photographs under one sentence would otherwise share a decision.
        const cacheKey = request.attachment ? null : cacheKeyFor(request.messages);
        const cached = cacheKey ? readRoutingCache(cacheKey) : null;

        let currentContent = "";
        let currentToolCalls: ToolCall[] | null = null;
        let finishReason = "stop";

        if (cached) {
            timer.count("chat.routing_cache_hit");
            timer.label("routing", "cached");
            currentToolCalls = replayToolCalls(cached, timer.elapsed().toString(36));
        } else {
            timer.label("routing", "model");
            timer.start("route");

            const routingStream = createChatCompletion(messages, openaiTools, {
                stream: request.stream,
                model: ROUTING_MODEL,
                temperature: request.temperature,
            });

            let routingFailed: string | null = null;

            for await (const event of routingStream) {
                if (event.type === "chunk") {
                    // The prompt asks for no preamble, but a model that writes
                    // one anyway should not have it swallowed — it is still the
                    // assistant talking.
                    currentContent += event.delta;
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: event.delta },
                    });
                } else if (event.type === "tool_calls") {
                    currentToolCalls = event.tool_calls;
                } else if (event.type === "error") {
                    routingFailed = event.error;
                    break;
                } else if (event.type === "done") {
                    finishReason = event.finish_reason ?? "stop";
                }
            }

            timer.end("route");
            timer.count("model_calls");

            if (routingFailed) {
                // `generateChatStream` logs the throw but not the endpoint it was
                // serving. Named here so a chat outage is findable by the same
                // query as every other route's.
                logRequestError(new Error(routingFailed), {
                    route: ROUTE,
                    phase: "provider_event",
                    method: req.method,
                    path: stripQuery(req.originalUrl),
                    streaming: true,
                });

                writeSseEvent(res, {
                    type: "error",
                    data: { error: routingFailed },
                });
                endSseStream(res);
                timer.label("outcome", "routing_error");
                timer.emit();

                return;
            }

            if (cacheKey && currentToolCalls?.length) {
                writeRoutingCache(cacheKey, currentToolCalls);
            }
        }

        // --- 2. No tool call: an ordinary prose answer ----------------------

        if (!currentToolCalls?.length) {
            timer.label("outcome", "no_tool");
            // Before `done`, never after — see `emitAttachment`.
            await emitAttachment(res, describing);
            writeSseEvent(res, {
                type: "done",
                data: { finish_reason: finishReason },
            });
            endSseStream(res);
            timer.end("open_to_done");
            timer.emit();

            return;
        }

        /**
         * The calls this turn is actually working from.
         *
         * Split from `currentToolCalls` because the retry round in step 5b
         * REPLACES them, and a `let` that is reassigned anywhere loses the
         * non-null narrowing the guard above just established — inside every
         * closure below, which is all of them. This one is proven present at
         * the point it is bound and only ever reassigned to another non-empty
         * set, so the narrowing is a property of the variable rather than of
         * where it happens to be read.
         */
        let activeToolCalls: ToolCall[] = currentToolCalls;

        writeSseEvent(res, {
            type: "tool_calls",
            data: {
                tool_calls: activeToolCalls.map((call) => ({
                    id: call.id,
                    name: call.function.name,
                })),
            },
        });

        // --- 3. The opening line, written here, at zero cost -----------------

        // Both are rewritten by the retry round in step 5b, which routes the
        // turn a second time and so changes what it is about.
        let routed = readRoutedSearch(activeToolCalls);
        let intentLine = buildIntentLine(routed);

        /**
         * A menu turn answers with ONE card for a whole meal, not a recipe.
         *
         * It shares this whole pipeline — routing, the opening line, the search
         * that resolves the main, the summary, the paint-after-the-prose
         * ordering — and differs only in what the tool returns and which frame
         * carries it. Giving it a second use-case would have duplicated all of
         * that to change two lines of it.
         */
        const isMenuTurn = activeToolCalls.some(
            (call) => call.function.name === "PLAN_MENU"
        );

        timer.label("turn", isMenuTurn ? "menu" : "dish");

        writeSseEvent(res, { type: "content", data: { delta: intentLine } });
        writeSseEvent(res, {
            type: "intent",
            data: {
                text: intentLine,
                dish: routed.dish ?? null,
                component: routed.component ?? null,
            },
        });

        // --- 4. Search and generate -----------------------------------------

        const emitStatus = (stage: string) => {
            const label = STAGE_LABEL[stage];
            if (label) writeSseEvent(res, { type: "status", data: { stage, label } });
        };

        emitStatus("catalogue");

        /**
         * Resolved by `onDishReady` — the generated dish's words, several
         * seconds before its id. `null` when the catalogue answered and nothing
         * was generated, in which case the tool result arrives first anyway.
         */
        let resolveEarlyDish: (dish: EarlyDish) => void = () => undefined;
        const earlyDishReady = new Promise<EarlyDish>((resolve) => {
            resolveEarlyDish = resolve;
        });

        /**
         * One round of the search: whatever tool calls the router asked for,
         * run with this turn's narration, argument layers and precomputed
         * vector.
         *
         * A function rather than a single expression because a turn can run it
         * TWICE — see the retry round in step 5b. Everything it closes over is
         * either fixed for the whole turn (the diet, the callbacks) or a buffer
         * the caller empties between rounds; nothing in here knows or needs to
         * know which round it is.
         */
        const runSearch = (calls: ToolCall[], span: string) => {
            timer.start(span);

            /**
             * How many cards this round may show, clamped.
             *
             * Read from THIS round's calls rather than the closure, because the
             * retry in step 5b re-routes and may ask for a different number.
             *
             * Clamped rather than defaulted or overridden: the model is allowed
             * to ask for several and is not allowed to ask for twenty. An
             * unstated `maxResults` means one, which is the ordinary answer.
             */
            const requested = readRoutedSearch(calls).maxResults;
            const cards = Math.min(
                Math.max(Math.trunc(requested ?? 1), 1),
                MAX_CHAT_RESULTS
            );

            if (cards > 1) timer.count("chat.multi_result", cards);

            return handleToolCalls(
                calls,
                tools,
                // Chat only surfaces a single suggestion; other callers keep the
                // service default of 5. Forward the user's diet/allergies so
                // generated suggestions respect them regardless of what the model
                // asked for.
                // Overrides — the model cannot say otherwise. `maxResults` is a
                // property of this SURFACE (chat shows one card), not of the
                // request, so there is nothing for the model to be right about.
                {
                    GET_RECIPE_SUGGESTIONS: { maxResults: cards },
                },
                {
                    GET_RECIPE_SUGGESTIONS: {
                        /**
                         * Collected, not written. The newest one is flushed once
                         * the prose has stopped moving — see step 7.
                         *
                         * Writing these live is the obvious thing to do and it is
                         * wrong: the generator finishes several seconds before the
                         * summary does, so a live card landed under a paragraph that
                         * was still growing and got shoved down the screen for the
                         * next three seconds. A card that arrives early is worth
                         * nothing if it cannot be read while it arrives.
                         */
                        onPartialSuggestion: (partial: PartialRecipeSuggestion) => {
                            partialsByTempId.set(partial.tempId, partial);
                        },
                        onDishReady: (dish: EarlyDish) => {
                            timer.start("persist");
                            resolveEarlyDish(dish);
                        },
                        onStage: (stage: string) => {
                            if (stage === "generate") timer.start("generate");
                            if (stage === "persist") timer.end("generate");
                            emitStatus(stage);
                        },
                        onMetric: (name: string, value?: number) =>
                            timer.count(name, value),
                        // Context, not an argument: this is a live promise the
                        // service consumes, and the argument layers are for values
                        // the MODEL could have written. Threading it through those
                        // would put it in the search input, where nothing reads it.
                        speculativeEmbedding,
                        // Every dish already on screen, straight from the client
                        // — unioned with the routed `exclude` by the handler.
                        // The routing model re-derived this from summary prose
                        // and measurably forgot everything but the newest card.
                        shownDishes: request.shownDishes,
                    },
                    // The menu tool resolves the main through the same search, so it
                    // takes the same narration and the same precomputed vector. It
                    // gets no `onPartialSuggestion` or `onDishReady`: a menu turn
                    // draws no recipe card, so a half-written dish has nowhere to go.
                    //
                    // It gets no `shownDishes` either, and that is a decision
                    // rather than an omission. A menu is built AROUND a dish, and
                    // the dish somebody wants to build a meal around is very often
                    // the one they were just shown — "make me a menu around that".
                    // Excluding what is on screen would refuse the most natural
                    // request this tool receives.
                    PLAN_MENU: {
                        onStage: (stage: string) => emitStatus(stage),
                        onMetric: (name: string, value?: number) =>
                            timer.count(name, value),
                        speculativeEmbedding,
                    },
                },
                // A DEFAULT, not an override: the user's saved skill level applies
                // unless they asked for something else in the message, in which case
                // the model sets `difficulty` from that and its value wins.
                {
                    GET_RECIPE_SUGGESTIONS: {
                        difficulty: request.difficulty,
                    },
                },
                // FLOORS — unioned with whatever the model wrote, so the
                // reader's saved diet and blacklist survive a model that omits
                // them AND an in-conversation "nothing with nuts" reaches the
                // search. These were overrides until 2026-09-14, which
                // protected the first property by destroying the second: the
                // client sends `[]` for a reader with nothing saved, and an
                // override of `[]` erased every restriction the router had
                // correctly read out of the sentence.
                {
                    GET_RECIPE_SUGGESTIONS: {
                        dietaryRestrictions: request.dietaryRestrictions ?? [],
                        blacklist: request.blacklist ?? [],
                    },
                }
            ).then((results) => {
                timer.end(span);
                timer.end("persist");

                return results;
            });
        };

        const toolResultsPromise = runSearch(activeToolCalls, "search");

        // Whichever comes first: the dish's words (generation finished, persist
        // still running) or the whole tool result (the catalogue answered, or
        // generation produced nothing).
        //
        // A menu turn never takes the early path. Its summary is about the MEAL,
        // and the only thing an early dish could tell it is the main — so
        // starting on that would have the model write about one course as
        // though it were the answer.
        const early = isMenuTurn
            ? { kind: "tool" as const }
            : await Promise.race([
                  earlyDishReady.then((dish) => ({ kind: "dish" as const, dish })),
                  toolResultsPromise.then(() => ({ kind: "tool" as const })),
              ]);

        // --- 5. Read the tool results -----------------------------------------

        /**
         * True once `parseTask` has settled — i.e. the dish has a real id.
         *
         * Read in step 7 to decide whether an unready card is worth drawing at
         * all: if persistence beat the summary home, the finished card can go
         * straight up and a skeleton would be a single frame of flicker.
         */
        let toolResultsSettled = false;

        /**
         * Read one round's tool results into this turn's buffers.
         *
         * A factory rather than one chained `.then`, because the retry round in
         * step 5b produces a SECOND set of results that has to land in the same
         * buffers and be awaited by the same step 7.
         *
         * It reads `activeToolCalls` to pair each result with the call that
         * produced it, and the retry reassigns that variable — so the ordering
         * there is load-bearing: round 1's body has fully run (the retry awaits
         * it before deciding) before round 2's calls replace it.
         */
        const readToolResults = (results: Promise<ChatMessage[]>) =>
            results.then((toolResults) => {
                for (let i = 0; i < toolResults.length; i++) {
                    const toolResult = toolResults[i];
                    const toolCall = activeToolCalls[i];

                    if (toolResult.role !== "tool" || !toolResult.content) continue;

                    try {
                        // Tool output crosses a JSON boundary, so this is an
                        // assertion about our own tool, not a validated parse.
                        // Fields are read defensively below.
                        const parsedResult = JSON.parse(
                            chatMessageText(toolResult.content)
                        ) as Partial<RecipeSuggestionResult>;

                        if (
                            toolCall?.function.name === "GET_RECIPE_SUGGESTIONS" &&
                            parsedResult.suggestions
                        ) {
                            resultSuggestions.push(...parsedResult.suggestions);

                            if (parsedResult.searchMetadata) {
                                resultMetadata = parsedResult.searchMetadata;
                            }

                            if (parsedResult.unsatisfied) {
                                resultUnsatisfied.reason = parsedResult.unsatisfied;
                            }
                        }

                        if (toolCall?.function.name === "PLAN_MENU") {
                            const withMenu = parsedResult as { menu?: MenuPlan };

                            if (withMenu.menu) resultMenu.plan = withMenu.menu;
                        }
                    } catch {
                        console.warn("[ProcessChat] Failed to parse tool result");
                    }
                }

                // Nothing is written here. Every frame this turn produces about a
                // card goes out in step 7, after the prose has settled.
                toolResultsSettled = true;

                return toolResults;
            });

        let parseTask = readToolResults(toolResultsPromise);

        /**
         * The tool messages that pair with `activeToolCalls`.
         *
         * Every id in an assistant turn's `tool_calls` must be answered by a
         * `tool` message with that id, or the provider rejects the request
         * outright. The routing model is free to emit more than one call, so
         * neither "take the first result" nor "send one synthesised message"
         * is safe on its own — each has to be matched to the shape it is
         * describing, which is what the two branches below do.
         */
        const summaryTurn = (
            source: { early: string } | { results: ChatMessage[] }
        ): ChatMessage[] => {
            // The early path answers exactly one call, so it presents exactly
            // one — the others are still in flight and cannot be reported.
            if ("early" in source) {
                return [
                    {
                        role: "assistant",
                        content: currentContent + intentLine || null,
                        tool_calls: [activeToolCalls[0]],
                    },
                    {
                        role: "tool",
                        tool_call_id: activeToolCalls[0].id,
                        content: source.early,
                    },
                ];
            }

            const answered = source.results.filter(
                (message) => message.role === "tool" && message.tool_call_id
            );

            return [
                {
                    role: "assistant",
                    content: currentContent + intentLine || null,
                    tool_calls: activeToolCalls.filter((call) =>
                        answered.some(
                            (message) => message.tool_call_id === call.id
                        )
                    ),
                },
                ...answered,
            ];
        };

        // --- 5b. One more round, when the first found nothing -----------------
        //
        // ## What this rescues
        //
        // A turn that invoked the tool and produced no card is a DEAD turn. The
        // client's test is `sawSuggestionTool && noSuggestions`, so it throws
        // the reply away, shows "Something went wrong" and offers a Regenerate
        // that re-runs the identical request — the same loop `SearchUnsatisfied`
        // was written to break, for the case where the search cannot say why it
        // came back empty. The user was going to spend this generation anyway by
        // pressing that button; spending it here buys the model the one thing
        // the button cannot, which is the knowledge that the first arguments
        // did not work.
        //
        // ## One round, and the cap is the feature
        //
        // Nothing here loops. An open-ended agent loop was considered and
        // rejected: this turn's whole shape depends on knowing its step count up
        // front — the opening line is templated before the search starts, the
        // summary runs concurrently with persistence, and the card is painted
        // after the prose stops moving. A variable number of rounds costs all
        // three, and meters a `questions` unit the user thinks is one question.
        //
        // ## What it deliberately does NOT retry
        //
        // - **A stated `unsatisfied`.** "No established dish under any name" and
        //   "that is a drink" are ANSWERS. Retrying one spends a second
        //   generation arguing with a verdict the search already reached, and
        //   puts "Something went wrong" back in front of a reader who had just
        //   been told the truth.
        // - **A menu turn.** Its empty case is the inquiry — `courses` unset
        //   means ASK — which is a complete answer with a prompt of its own.
        // - **A turn whose dish was written and then dropped.** That path
        //   resolves `earlyDishReady`, so the summary is already running against
        //   a dish, and those drops are also the ones that state a reason. Only
        //   the branch where the TOOL RESULT won the race reaches here — which
        //   is also what makes the check free for every turn that did find
        //   something, since on that branch the results have already settled.
        //
        // ## A REFUSAL does not get a round of its own, and that was decided
        //
        // "Something else" was the case this whole area was rebuilt for, and the
        // obvious shape — a third round, armed when the reader turns a card down
        // — was considered and REJECTED. Two reasons, and the second is the one
        // that settles it:
        //
        // 1. **The turn's shape depends on knowing its step count up front.**
        //    The opening line is templated before the search starts, the summary
        //    runs concurrently with persistence, and the card is painted after
        //    the prose stops moving. A variable number of rounds costs all
        //    three, and meters a `questions` unit the reader thinks is one
        //    question. That argument is unchanged by anything here.
        // 2. **The refusal is now expressed in the ARGUMENTS, so there is
        //    nothing left for an extra round to discover.** It used to be
        //    invisible: the router pinned the dish the reader was rejecting, the
        //    search had no way to tell that from a follow-up, and the only place
        //    the mistake could surface was after the fact. Now `refusing` says
        //    it outright, `shownDishes` carries every card already on screen, and
        //    the generator is given the exclusions — so round ONE is already the
        //    round that knows. Adding a round to recover from a failure that has
        //    been moved upstream is paying for a second attempt at a question
        //    the first attempt was finally asked correctly.
        //
        // What the refusal case DID need was the honest ending this block tests
        // for. A generation that circled back onto an excluded row used to
        // report `unsatisfied: no_known_dish` — a claim about the REQUEST that
        // was not true, and which suppressed the retry below by satisfying its
        // "gave no reason" test. `searchRecipeSuggestions` now returns that case
        // with no reason at all, so the round already bounded here fires and
        // re-routes with the failed attempt in context. One mechanism, two
        // callers, still capped at two.
        let searchRounds = 1;
        let retryOutcome: "searched" | "answered" | null = null;

        if (
            !isMenuTurn &&
            early.kind === "tool" &&
            searchRounds < MAX_SEARCH_ROUNDS
        ) {
            const firstRound = await parseTask;

            const foundNothing =
                resultSuggestions.length === 0 &&
                !resultMenu.plan &&
                !resultUnsatisfied.reason;

            if (foundNothing) {
                searchRounds++;
                timer.count("chat.search_retry");

                // A route that produced nothing must not be handed to the next
                // person who types the same sentence — see `deleteRoutingCache`.
                // Round 2's route is deliberately NOT written in its place: it
                // was reached with the failure in context, and caching it under
                // a key that means "what this message routes to" would store an
                // answer to a different question.
                if (cacheKey) deleteRoutingCache(cacheKey);

                // Round 1's partials were collected and never written — step 7
                // is the only thing that emits them and it has not run yet.
                // Dropping them here is what stops it withdrawing a card the
                // client was never shown.
                partialsByTempId.clear();

                emitStatus("retry");
                timer.start("retry_route");

                const retryStream = createChatCompletion(
                    [
                        ...messages,
                        // The round that failed, presented exactly as the
                        // summary would present it — an assistant turn whose
                        // tool calls are all answered. A provider rejects
                        // anything less.
                        ...summaryTurn({ results: firstRound }),
                        { role: "system", content: RETRY_PROMPT },
                    ],
                    // The one tool, not both. A retry may search again; it may
                    // not turn a dish turn into a menu turn — `isMenuTurn` was
                    // read once, above, and the summary prompt and step 7's
                    // frames have already branched on it.
                    convertToolsToOpenAiTools({
                        GET_RECIPE_SUGGESTIONS: getRecipeSuggestionsTool,
                    }),
                    {
                        stream: request.stream,
                        model: ROUTING_MODEL,
                        temperature: request.temperature,
                    }
                );

                let retryCalls: ToolCall[] | null = null;
                let retryProse = "";
                let retryFailed: string | null = null;

                for await (const event of retryStream) {
                    if (event.type === "chunk") {
                        // Written live, like the routing call's own preamble.
                        // On the prose branch this IS the reply, and buffering
                        // it would leave the screen still for the length of a
                        // second model call, on a turn that has already been
                        // slow.
                        //
                        // The break comes with the first token rather than
                        // before the call, because a round that answers with a
                        // tool call writes nothing here — and an unconditional
                        // one would leave a blank line hanging under the
                        // opening line of every retried turn that went on to
                        // find something.
                        if (!retryProse) {
                            writeSseEvent(res, {
                                type: "content",
                                data: { delta: "\n\n" },
                            });
                        }

                        retryProse += event.delta;
                        currentContent += event.delta;
                        writeSseEvent(res, {
                            type: "content",
                            data: { delta: event.delta },
                        });
                    } else if (event.type === "tool_calls") {
                        retryCalls = event.tool_calls;
                    } else if (event.type === "error") {
                        retryFailed = event.error;
                        break;
                    }
                }

                timer.end("retry_route");
                timer.count("model_calls");

                if (retryFailed) {
                    // Logged, never surfaced. The turn already has an outcome —
                    // round 1 found nothing — and this call was the optional
                    // attempt to improve on it, so a failure here leaves the
                    // reader exactly where they would have been without any of
                    // this rather than replacing an empty turn with a broken
                    // one.
                    logRequestError(new Error(retryFailed), {
                        route: ROUTE,
                        phase: "provider_event",
                        method: req.method,
                        path: stripQuery(req.originalUrl),
                        streaming: true,
                        detail: { stage: "retry" },
                    });
                }

                if (retryCalls?.length) {
                    timer.label("retry", "searched");
                    retryOutcome = "searched";

                    activeToolCalls = retryCalls;
                    routed = readRoutedSearch(retryCalls);
                    intentLine = buildRetryLine(routed);

                    // The same three frames the first attempt wrote, in the
                    // same order, and every one of them is something the
                    // client's reducer REPLACES rather than appends: a second
                    // `intent` supersedes the first, which is what keeps the
                    // card's regenerate control pointed at the dish this turn
                    // actually went looking for.
                    writeSseEvent(res, {
                        type: "tool_calls",
                        data: {
                            tool_calls: retryCalls.map((call) => ({
                                id: call.id,
                                name: call.function.name,
                            })),
                        },
                    });
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: `\n\n${intentLine}` },
                    });
                    writeSseEvent(res, {
                        type: "intent",
                        data: {
                            text: intentLine,
                            dish: routed.dish ?? null,
                            component: routed.component ?? null,
                        },
                    });

                    toolResultsSettled = false;
                    parseTask = readToolResults(
                        runSearch(retryCalls, "search_retry")
                    );
                } else if (retryProse) {
                    timer.label("retry", "answered");
                    retryOutcome = "answered";

                    /**
                     * The model looked twice and chose words over another
                     * search. That IS the reply and it has already been
                     * streamed — but the client cannot tell it apart from a
                     * stream that died halfway, because its whole test is "the
                     * tool was invoked and no card came back", which is exactly
                     * this shape. The frame is what says the turn is finished
                     * and correct, so the prose is committed rather than thrown
                     * away behind a Regenerate button.
                     *
                     * `no_known_dish` is the honest reason of the two: the
                     * catalogue held nothing and the model, having seen that,
                     * declined to write one. `attempted` is empty because
                     * nothing was written to be refused — and because the
                     * sentence the reader gets is the model's own, step 7 must
                     * not add `buildUnsatisfiedLine`'s on top of it.
                     */
                    resultUnsatisfied.reason = {
                        reason: "no_known_dish",
                        attempted: [],
                    };
                } else {
                    // Neither a search nor a sentence: the call failed, or it
                    // returned nothing at all. Claiming `unsatisfied` here would
                    // mark an EMPTY reply as a finished answer and commit a turn
                    // whose only text is "let me look that up" — so the turn is
                    // left exactly as round 1 ended it, a failure the client
                    // offers to retry. No worse than before this step existed,
                    // which is the floor every branch here has to clear.
                    timer.label("retry", "failed");
                }
            } else {
                timer.label("retry", "none");
            }
        }

        // --- 6. Summarise, concurrently with whatever is left of persistence --

        const summaryTask = (async () => {
          try {
            let turn: ChatMessage[];

            if (early.kind === "dish") {
                turn = summaryTurn({ early: earlyDishAsToolContent(early.dish) });
                timer.label("summary_start", "early");
            } else {
                // Awaiting `parseTask` rather than `toolResultsPromise`,
                // because it is `parseTask` that fills `resultSuggestions` —
                // chaining off the same promise would work only by relying on
                // the order the two `.then`s were registered in, which is
                // exactly the kind of dependency that survives until someone
                // reorders two lines.
                const toolResults = await parseTask;

                // Nothing to summarise. A turn that produced neither a dish nor
                // a menu is already a failed turn upstream; writing prose about
                // it would give the client something to commit instead of a
                // retry.
                if (resultSuggestions.length === 0 && !resultMenu.plan) {
                    timer.label("summary_start", "skipped");

                    return;
                }

                turn = summaryTurn({ results: toolResults });
                timer.label("summary_start", "after_tool");
            }

            // The client concatenates deltas verbatim, so the break between the
            // opening line and the summary has to be sent.
            writeSseEvent(res, { type: "content", data: { delta: "\n\n" } });
            emitStatus("summary");

            timer.start("summary");

            const summaryStream = createChatCompletion(
                [
                    ...messages,
                    ...turn,
                    {
                        role: "system",
                        content: !isMenuTurn
                            ? SUMMARY_PROMPT
                            : // Empty courses is the question, not a failure —
                              // see `MenuPlan.courses`.
                              resultMenu.plan?.courses.length
                              ? MENU_SUMMARY_PROMPT
                              : MENU_INQUIRY_PROMPT,
                    },
                ],
                [],
                {
                    stream: request.stream,
                    model: request.model,
                    temperature: request.temperature,
                }
            );

            for await (const summaryEvent of summaryStream) {
                if (summaryEvent.type === "chunk") {
                    writeSseEvent(res, {
                        type: "content",
                        data: { delta: summaryEvent.delta },
                    });
                }
            }

            timer.end("summary");
            timer.count("model_calls");
          } catch (error) {
            // The prose is the least important half of this turn. A summary
            // that fell over must not take the card down with it — and the
            // card is gated on this task finishing, so a rejection here would
            // have held it back forever.
            logRequestError(error, {
                route: ROUTE,
                phase: "mid_stream",
                method: req.method,
                path: stripQuery(req.originalUrl),
                streaming: true,
                detail: { stage: "summary" },
            });

            timer.label("summary_outcome", "failed");
          }
        })();

        // --- 7. Paint the card, once the prose has stopped moving -------------
        //
        // ## Order on the wire IS the layout
        //
        // A chat bubble is prose with a card under it, so anything written into
        // the text after the card exists pushes the card down the screen. The
        // generator finishes several seconds before the summary does, so a card
        // emitted when it was ready landed under a paragraph that was still
        // growing and got shoved downward for the next three seconds — arriving
        // early is worth nothing if it cannot be read while it arrives.
        //
        // So the whole turn reads: line, summary, unready card, ready card. The
        // card still arrives far earlier than it used to, but that comes from
        // summarising and persisting CONCURRENTLY (step 6), not from racing the
        // card against the words.
        //
        // This is a partial reversal of the 2026-08-22 change that started
        // streaming partials live, and it restores the ordering the original
        // buffering was protecting — "held back, the card is the last thing to
        // animate in" was right about the order and wrong only about how long
        // the reader should wait for it.
        await summaryTask;

        /**
         * The unready card: everything the generator wrote, before it has an id.
         *
         * Skipped when persistence already finished, because then the real card
         * is one await away and a skeleton would be a single frame of flicker
         * rather than a state anybody perceives.
         */
        if (!toolResultsSettled) {
            for (const partial of partialsByTempId.values()) {
                writeSseEvent(res, { type: "suggestion", data: partial });
            }

            if (partialsByTempId.size > 0) timer.count("suggestion.partial_shown");
        }

        await parseTask;

        // ONE card for the whole meal. A menu turn emits no `suggestion` at
        // all: the courses do not exist yet, and a recipe card beside the menu
        // would offer a dish the menu is not built from.
        if (resultMenu.plan) {
            writeSseEvent(res, { type: "menu", data: resultMenu.plan });
        }

        // The ready card. Shares its `tempId` with the partial above, so the
        // client upgrades that card in place rather than adding a second one.
        for (const suggestion of resultSuggestions) {
            writeSseEvent(res, { type: "suggestion", data: suggestion });
        }

        /**
         * A dish that was written and then went nowhere.
         *
         * The generator can be overruled after the fact — the authenticity
         * review drops it, dedup folds it into a sibling, the write fails.
         * Saying so explicitly is the difference between a card that disappears
         * for no reason and one the client can remove deliberately; the same
         * `withdrawn` vocabulary the menu composer uses for a course it will not
         * fill. It matters even though the partial is only drawn a moment
         * earlier: without it, that moment lasts for the rest of the session.
         */
        for (const tempId of partialsByTempId.keys()) {
            const enriched = resultSuggestions.some(
                (item) => item.tempId === tempId
            );

            if (!enriched) {
                writeSseEvent(res, { type: "withdrawn", data: { tempId } });
                timer.count("suggestion.withdrawn");
            }
        }

        /**
         * The turn has nothing to offer, and says so.
         *
         * Written after the cards rather than before, for the same reason they
         * are written after the prose: this IS the reply's last paragraph, and
         * there is nothing above it to push down (the summary is skipped on this
         * path — there was no dish to summarise).
         *
         * Two frames, deliberately. The sentence goes out as `content` so a
         * client that has never heard of `unsatisfied` still renders a complete
         * reply; the frame is what tells a client that HAS heard of it that this
         * turn is finished and correct, so it commits the exchange instead of
         * offering to regenerate a request the server has just explained cannot
         * be answered.
         */
        const unsatisfied = resultUnsatisfied.reason;

        if (unsatisfied && resultSuggestions.length === 0) {
            // ...unless the retry round already wrote one in its own words. Two
            // sentences saying "I could not find it", in two different voices,
            // is worse than either of them alone.
            if (retryOutcome !== "answered") {
                writeSseEvent(res, {
                    type: "content",
                    data: {
                        delta: `\n\n${buildUnsatisfiedLine(unsatisfied.reason, routed)}`,
                    },
                });
            }

            writeSseEvent(res, { type: "unsatisfied", data: unsatisfied });
        }

        if (resultMetadata) {
            writeSseEvent(res, { type: "metadata", data: resultMetadata });
        }

        // Shadow only — logs a verdict on whether the card actually satisfies
        // what was asked, and changes nothing. Off unless `CONSTRAINT_SHADOW=on`;
        // see `constraint-shadow.ts` for what the data is meant to settle.
        // Registered as a background task so it cannot sit between the reader
        // and `done`, and so Lambda drains it rather than freezing it mid-flight.
        const shadowCandidate = resultSuggestions.find(
            (item): item is RecipeSuggestionItem => "id" in item
        );

        if (latestPrompt && shadowCandidate) {
            trackBackgroundTask(
                shadowCheckConstraints(latestPrompt, {
                    name: shadowCandidate.name,
                    description: shadowCandidate.description,
                    tags: shadowCandidate.tags.map((tag) => tag.name),
                    ingredients: shadowCandidate.ingredients.map(
                        (ingredient) => ingredient.name
                    ),
                })
            );
        }

        timer.label(
            "outcome",
            resultMenu.plan
                ? resultMenu.plan.courses.length
                    ? "menu"
                    : "menu_inquiry"
                : resultSuggestions.length > 0
                  ? "suggested"
                  : unsatisfied
                    ? `unsatisfied_${unsatisfied.reason}`
                    : "empty"
        );
        timer.count("suggestions", resultSuggestions.length);

        // Before `done`, never after — see `emitAttachment`.
        await emitAttachment(res, describing);

        writeSseEvent(res, { type: "done", data: { finish_reason: "stop" } });

        timer.end("open_to_done");

        // Emitted before `end` so a client watching the stream can read it, and
        // logged either way. Unknown frame types are ignored by every client the
        // app has ever shipped, so this is additive on the wire.
        writeSseEvent(res, { type: "metrics", data: timer.emit() });

        endSseStream(res);
    } catch (error) {
        logRequestError(error, {
            route: ROUTE,
            phase: res.headersSent ? "mid_stream" : "pre_stream",
            method: req.method,
            path: stripQuery(req.originalUrl),
            streaming: true,
        });

        // Try to send error via SSE if headers not sent
        if (!res.headersSent) {
            initSseStream(res);
        }

        writeSseEvent(res, {
            type: "error",
            data: {
                error: error instanceof Error ? error.message : "Unknown error",
            },
        });

        timer.label("outcome", "exception");
        timer.emit();

        endSseStream(res);
    }
}
