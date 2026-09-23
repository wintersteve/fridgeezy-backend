import { config } from "dotenv";

/**
 * Loads an eval's environment, and exists because a function call cannot do it.
 *
 * `@fridgeezy/supabase` throws on a missing `SUPABASE_URL` at *import* time, so
 * the variables have to be set before that module is evaluated. Imports are
 * evaluated BEFORE any statement in the importing file — so the obvious
 *
 *     import { config } from "dotenv";
 *     config();
 *     import { ... } from "../modules/recipes/services";   // already too late
 *
 * sets nothing in time, however high up the call sits. A side-effect import is
 * the only form that runs in source order relative to the others, which is why
 * this is a module rather than three lines at the top of the eval.
 *
 * **Import it FIRST, before anything reaching Supabase.**
 *
 * Two files, in this order, because the pair is split by purpose:
 * `apps/api/.env` is the committed secrets file (OpenAI, Gemini) and carries no
 * stack pointer, while `.env.dev` is what the local `env` target writes and
 * carries `SUPABASE_URL` and its keys. dotenv never overwrites a variable that
 * is already set, so secrets come from the first, the stack from the second,
 * and anything exported in the shell beats both — which is what lets an eval be
 * pointed at a different stack for one run without editing a file.
 *
 * The older evals in this directory call `config()` on `.env` alone and so only
 * run for somebody who has merged the two by hand. Moving them onto this is a
 * tidy-up worth doing; it is not this file's job to do it silently.
 */
config();
config({ path: ".env.dev" });
