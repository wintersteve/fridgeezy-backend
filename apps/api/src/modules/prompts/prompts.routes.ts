import { Router } from "express";

import { PromptsController } from "./prompts.controller";

const router = Router();

/**
 * Prompt history — everything a cook has typed, and the tools to forget it.
 *
 * Account tier, not premium: this is the user's own data on the way back to
 * them, and there is no model call behind any of these four routes.
 *
 * The WRITE that matters is not here. `POST /chat`,
 * `POST /recipes/:id/chat` and `POST /recipes/modify` record their own turn as
 * it passes (`recordPrompt`), because the API is holding the text anyway and a
 * capture the client can forget is one that goes missing — which is exactly
 * what happened to the recipe-scoped Ask sheet, whose prompts were never
 * written anywhere. `POST /` below is for prompts those routes never see.
 */
router.get("/", PromptsController.list);
router.post("/", PromptsController.save);

/**
 * Collection delete before the single delete: Express walks layers in
 * registration order, and `/` and `/:id` cannot collide (one segment against
 * none), so this pair is order-independent. Written this way anyway to keep the
 * two DELETEs adjacent and readable as one decision.
 */
router.delete("/", PromptsController.forgetAll);
router.delete("/:id", PromptsController.forgetOne);

export const PromptsRoutes = router;
