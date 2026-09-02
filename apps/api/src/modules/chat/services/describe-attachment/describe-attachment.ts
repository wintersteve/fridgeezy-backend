import type { ChatAttachment } from "@fridgeezy/schemas";
import { generateCompletion } from "@fridgeezy/llm";
import type { Response } from "express";

import { writeSseEvent } from "../sse";

/**
 * The model that looks at the photograph a second time, to write the sentence
 * the conversation keeps.
 *
 * Small and cheap on purpose. This call is not answering the question — the
 * main turn does that, with the real image in front of it — it is writing the
 * caption that stands in for the picture on every LATER turn, which is a
 * description task a mini model does perfectly well.
 */
const VISION_MODEL = process.env.CHAT_VISION_MODEL || "gpt-4.1-mini";

/**
 * Long enough to name a product and read a short ingredient list, short enough
 * that it cannot quietly become a second answer competing with the real one.
 */
const MAX_DESCRIPTION_CHARS = 300;

const PROMPT = [
    "You are labelling a photograph a cook has just attached to a chat message, for a note that will be kept in place of the image.",
    "Write ONE sentence, under 40 words, describing only what is visibly in the photograph.",
    "",
    "Be concrete and name things: brands, product names, printed weights, and any ingredient list you can read on a label. If it is food, say what it is and its apparent state (raw, browned, split, risen). If it is equipment, say what it is and its size if that is printed or obvious.",
    "",
    "Do NOT answer any question, give advice, offer a recipe, or say what the cook should do next. Do not begin with 'The image shows' or 'A photo of' — just describe it.",
    "If the photograph is too dark, blurred or crowded to identify anything, say exactly: unclear photograph.",
].join("\n");

/**
 * What the photograph was, in one line — the thing that survives the turn.
 *
 * ## Why the picture does not survive instead
 *
 * A chat re-sends its whole transcript on every turn. Keeping the image in that
 * transcript means re-uploading it for the rest of the conversation, against a
 * 6 MB request ceiling it shares with the history — so a fourth attachment
 * cannot be sent at all. `ChatRequestSchema.attachment` keeps the image out of
 * the transcript entirely, and this is what fills the hole it leaves: the client
 * appends the sentence to its own message for every later turn, so a follow-up
 * ("does it have salt in it?") is answered from what was actually read off the
 * label rather than from nothing.
 *
 * It is therefore worth spending a second, small call on. The alternative —
 * asking the answering model to also emit a description — puts a second job
 * inside a prompt that on the recipe route is already holding its opening tokens
 * back to read a classification sentinel, and a caption is exactly the kind of
 * thing that would start being emitted in place of one.
 *
 * **Never throws.** A failed description costs the conversation its memory of
 * the picture, which the reader can repair by attaching it again; a failed
 * description that took the whole turn down with it costs them the answer they
 * were waiting for. Returns null and lets the turn carry on.
 */
export async function describeAttachment(
    attachment: ChatAttachment
): Promise<string | null> {
    try {
        const { text } = await generateCompletion({
            model: { openai: VISION_MODEL },
            system: PROMPT,
            user: "Describe this photograph.",
            image: {
                kind: "base64",
                data: attachment.data,
                mimeType: attachment.mimeType,
            },
            label: "chat.describe_attachment",
        });

        const description = text.trim();

        if (!description || /^unclear photograph\.?$/i.test(description)) {
            return null;
        }

        return description.length > MAX_DESCRIPTION_CHARS
            ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd()}…`
            : description;
    } catch (error) {
        console.error("[describeAttachment] failed:", error);
        return null;
    }
}

/**
 * Write the caption to the stream, if there was an attachment and it resolved.
 *
 * **Must be called before the `done` frame**, not after it. The client treats
 * `done` as the end of the stream and stops listening, so a frame written after
 * it is not late — it is gone, with nothing on either side reporting a problem.
 * That is the same class of silent loss as a frame name missing from
 * `create-sse-client`'s event list.
 *
 * By the time `done` arrives the reply has been streaming for seconds and this
 * promise has almost always already settled, so awaiting it here costs nothing
 * in practice while keeping the ordering guaranteed rather than lucky.
 */
export async function emitAttachment(
    res: Response,
    describing: Promise<string | null> | null
): Promise<void> {
    if (!describing) return;

    const description = await describing;

    if (!description) return;

    writeSseEvent(res, { type: "attachment", data: { description } });
}
