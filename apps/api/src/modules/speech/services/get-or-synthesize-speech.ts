import { createHash } from "node:crypto";

import { synthesizeSpeech } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

import { toDeviceReachable } from "../../../utils/device-reachable-url";

const BUCKET = "recipe_speech";

// Content-addressed: the same text always hashes to the same path, so a
// second request for it — from any user, for any recipe — is a storage read
// instead of a Gemini call. See the bucket's migration for why this is keyed
// on the text rather than a recipe/step id.
const speechStoragePath = (text: string): string =>
    `${createHash("sha256").update(text).digest("hex")}.wav`;

// Without this, local dev hands the client a `127.0.0.1` URL — on a physical
// device that's the device itself, so `expo-audio` fails to load the source
// silently: no error, no sound, exactly what this looked like from the app.
// See `toDeviceReachable` for the full story; `create-recipe-image.ts` hit the
// same trap first.
const getPublicUrl = (path: string): string =>
    toDeviceReachable(
        supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
    );

/**
 * Returns a public URL for `text` spoken aloud, generating and caching it on
 * a miss.
 *
 * Mirrors `generateAndUploadRecipeImage`'s list-then-upload shape: an existing
 * object short-circuits the Gemini call entirely, and a fresh one is uploaded
 * with `upsert: true` so a race between two callers hashing to the same path
 * (identical step text requested by two users at once) resolves to whichever
 * upload lands second rather than erroring.
 */
export async function getOrSynthesizeSpeech(text: string): Promise<string> {
    const path = speechStoragePath(text);

    const { data: existing } = await supabaseAdmin.storage
        .from(BUCKET)
        .list("", { search: path });

    if (existing?.some((file) => file.name === path)) {
        return getPublicUrl(path);
    }

    const { audioBase64, mimeType } = await synthesizeSpeech({ text });

    const { error } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, Buffer.from(audioBase64, "base64"), {
            contentType: mimeType,
            upsert: true,
        });

    if (error) {
        throw new Error(`Failed to upload synthesized speech: ${error.message}`);
    }

    return getPublicUrl(path);
}
