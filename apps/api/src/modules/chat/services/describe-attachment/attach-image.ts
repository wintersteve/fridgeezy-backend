import { chatMessageText } from "@fridgeezy/schemas";
import type { ChatAttachment, ChatMessage } from "@fridgeezy/schemas";

/**
 * Put the turn's photograph on the message it belongs to.
 *
 * The image arrives at the top level of the request rather than inside
 * `messages` — see `ChatRequestSchema.attachment` for why — so somebody has to
 * decide which turn it is attached to. It is always the **last user message**:
 * a photograph is sent with a message, and the request carries at most one.
 *
 * ## Three things it refuses to do
 *
 * - **A transcript whose last user turn cannot be found** gets the attachment
 *   dropped rather than appended as a message of its own. A bare image with no
 *   turn to belong to is a request shape the client cannot produce, so producing
 *   one here would only mean guessing on behalf of a caller that is already
 *   broken.
 * - **It never touches an earlier turn.** Only the tail is multimodal, which is
 *   what keeps the provider translations simple and what makes the 6 MB
 *   guarantee — one image per request — true by construction rather than by
 *   convention.
 * - **It does not re-wrap a message that is already multimodal.** The client
 *   sends plain strings; anything else arriving here means an assumption has
 *   already broken, and quietly merging would hide it.
 *
 * Returns a new array. The input is `request.messages`, which several other
 * readers (the prompt recorder, the routing cache key) hold at the same time.
 */
export function attachImageToLastUserMessage(
    messages: ChatMessage[],
    attachment: ChatAttachment
): ChatMessage[] {
    const index = messages.map((message) => message.role).lastIndexOf("user");

    if (index === -1) return messages;

    const target = messages[index];

    if (Array.isArray(target.content)) return messages;

    const text = chatMessageText(target.content);

    const withImage: ChatMessage = {
        ...target,
        content: [
            { type: "image", data: attachment.data, mimeType: attachment.mimeType },
            // An attachment sent with no sentence is a shape the client allows
            // deliberately — the composer offers a default question per surface
            // but does not require one — so an empty text part is dropped rather
            // than sent. Both providers reject an empty text block.
            ...(text ? [{ type: "text" as const, text }] : []),
        ],
    };

    return [...messages.slice(0, index), withImage, ...messages.slice(index + 1)];
}
