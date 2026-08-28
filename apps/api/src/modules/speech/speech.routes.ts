import { Router } from "express";

import { requireEntitlement } from "../../middleware/require-entitlement";

import { SpeechController } from "./speech.controller";

const router = Router();

/**
 * Speak this text aloud. **Free to any signed-in account**, and the only model
 * call in the app that is.
 *
 * It earns that because `getOrSynthesizeSpeech` is content-addressed: the text
 * is hashed to a storage path, so the first request for a step pays Gemini and
 * every request for that same step afterwards — from any user, on any recipe —
 * is a storage read. The catalogue is shared, so its steps converge on synthesised
 * within days of anyone cooking them. Cooking mode is free, and a cooking mode
 * that cannot read a step to someone with their hands in a bowl is not one.
 */
router.post("/synthesize", SpeechController.synthesize);

/**
 * Turn a spoken utterance into an intent. **Premium**, and the reason it is
 * split from its neighbour is worth writing down, because "speech" reads like
 * one feature and is two.
 *
 * `interpretCommand` is an ordinary LLM classifier with no cache to amortise
 * it: every utterance is unique, so every call costs. That puts it with chat and
 * modify rather than with synthesis above — voice control is an AI feature that
 * happens to arrive as audio, not part of "basic TTS".
 *
 * This is the ONE per-route gate left in the app. Every other paid route is
 * covered by its mount (`MOUNTS` in `rest/index.ts`), so if this module ever
 * loses its free half, delete this and give the mount `tier: "subscriber"`
 * instead — the default — rather than leaving a lone opt-in behind.
 */
router.post("/command", requireEntitlement, SpeechController.command);

export const SpeechRoutes = router;
