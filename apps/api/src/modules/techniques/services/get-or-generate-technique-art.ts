import { generateImage } from "@fridgeezy/genai";
import { supabaseAdmin } from "@fridgeezy/supabase";

import { toDeviceReachable } from "../../../utils/device-reachable-url";

import { normaliseGround } from "./normalise-ground";
import { buildTechniqueArtPrompt } from "./technique-art-prompt";

const BUCKET = "technique_art";

/**
 * One object per canonical action name. Deterministic, so two readers asking
 * what deglazing means at the same moment resolve to the same path and the
 * second upload simply wins — the `upsert` below, `getOrSynthesizeSpeech`'s
 * resolution of the same race.
 */
const storagePath = (action: string): string => `${action}.jpg`;

// Local dev otherwise hands the client a `127.0.0.1` URL, which on a physical
// device is the device itself — the image fails to load with no error at all.
// `create-recipe-image.ts` hit this first; see `toDeviceReachable`.
const publicUrl = (path: string): string =>
    toDeviceReachable(
        supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
    );

export interface TechniqueArtResult {
    action: string;
    imageUrl: string;
    caption: string;
    /** Whether this caller paid for the generation. */
    generated: boolean;
}

/**
 * The public URL for a technique's painting, drawing and caching it on a miss.
 *
 * ## The closed vocabulary is the spend bound, and it is why this is free
 *
 * The action is looked up in `cooking_actions` before anything is generated,
 * and an unknown name is refused. That table is a curated ~148 rows, so the
 * total this route can ever cost — across every user, for all time — is those
 * 148 images once. There is no sequence of requests that spends more, because
 * the 149th distinct request cannot exist.
 *
 * That is a stronger version of the argument `/speech/synthesize` already
 * makes: content-addressing means the catalogue converges on drawn, and a
 * feature everybody after the first reader gets for free out of storage is not
 * a marginal cost. `FEATURE_TIER`'s own rule is that a subscription entry
 * exists because a thing has one.
 *
 * ## The caption comes from the curated columns, not from the image model
 *
 * It has to survive being read by somebody who cannot see the picture, and it
 * has to be true of whatever came back — which nothing can guarantee about an
 * image. So it describes the technique from `cooking_actions.description`
 * rather than claiming to describe the frame, and the bundled six keep their
 * hand-written lines precisely because those were written against a picture
 * somebody looked at.
 */
export async function getOrGenerateTechniqueArt(
    action: string,
): Promise<TechniqueArtResult | null> {
    const { data: row, error } = await supabaseAdmin
        .from("cooking_actions")
        .select("name, description, tips")
        .eq("name", action)
        .maybeSingle();

    if (error) {
        throw new Error(`Failed to read cooking action: ${error.message}`);
    }

    // Not an error: the client resolves names from the same table, so a miss
    // here means the two are out of step (a stale cached action list, most
    // likely). The caller turns this into a 404 and the reply carries on
    // without a picture, which is what every un-illustrated verb does anyway.
    if (!row) return null;

    const caption = row.description?.trim() || row.name.replace(/_/g, " ");
    const path = storagePath(row.name);

    const { data: existing } = await supabaseAdmin.storage
        .from(BUCKET)
        .list("", { search: path });

    if (existing?.some((file) => file.name === path)) {
        return {
            action: row.name,
            imageUrl: publicUrl(path),
            caption,
            generated: false,
        };
    }

    const prompt = await buildTechniqueArtPrompt(row);

    const { base64Data } = await generateImage({
        prompt,
        // 4:3 — the client draws these in a 4:3 plate, so the painting is
        // composed for the frame it is shown in rather than cropped into it.
        aspectRatio: "4:3",
    });

    if (!base64Data) {
        throw new Error(
            `No image data for "${row.name}" — the model likely answered with text.`,
        );
    }

    /*
      The model is asked for a `#FFFFFF` ground and returns something within a
      few units of it, differently on every render. That is corrected here
      rather than lived with, because the client paints one backdrop colour
      behind every plate and a single hex cannot match a set that drifts. See
      `normaliseGround`, including what the correction deliberately does not
      touch.
    */
    const { image, before, gains } = await normaliseGround(
        Buffer.from(base64Data, "base64"),
    );

    console.log(
        `[techniqueArt] ${row.name}: ground ${before} -> #FFFFFF (gains ${gains
            .map((g) => g.toFixed(3))
            .join("/")})`,
    );

    const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, image, {
            // Always JPEG, whatever the model returned: the correction decodes
            // and re-encodes, so the response's own mime type describes the
            // input rather than the bytes going up. The storage path has said
            // `.jpg` since this bucket was created.
            contentType: "image/jpeg",
            // Two readers asking at once hash to one path; last upload wins
            // rather than the second erroring.
            upsert: true,
            // Seconds, NOT a header — supabase-js prefixes `max-age=`. See
            // `get-or-synthesize-speech.ts` for why this is currently inert on
            // this project and kept anyway.
            cacheControl: "31536000",
        });

    if (uploadError) {
        throw new Error(
            `Failed to upload technique art: ${uploadError.message}`,
        );
    }

    return {
        action: row.name,
        imageUrl: publicUrl(path),
        caption,
        generated: true,
    };
}
